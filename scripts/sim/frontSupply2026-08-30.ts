/**
 * Front supply after FRONT_SUPPLY: what a formation draws, and what feeds it.
 *
 * The trigger was the live German front at turn 503. Fifty-nine Warsaw Pact formations
 * read CUT OFF (level 22 with the real interdiction applied) while holding 84% air
 * superiority, and no lever the commander had could move it: demand was every
 * formation's treasury upkeep / 12, 905 of 1,871 of it from wings and missile brigades
 * parked at a LAND front, 52 formations in depth billed as if they stood in the line,
 * and a Logistics command worth a flat +20 against a deficit of ~1,160.
 *
 * Four rules, all in `FRONT_SUPPLY` (config.ts), measured here on the live front:
 *
 *   A  air / naval / rocket formations draw `offFrontDemand` of their upkeep
 *   B  a Logistics command delivers `logisticsCommandShare` of its contingent's demand
 *      times effectiveness, instead of a flat 20
 *   C  formations the engagement plan leaves in depth draw `depthDemand`
 *   E  the side on its own soil hauls `hostSideThroughput`
 *
 * This script is written to run unchanged in a checkout WITHOUT the change (it only
 * calls `buildBattleSide`, `battleForecast` and `resolvePvpBattle`), so the "before"
 * column is the same script run on `development` and the "after" column is this
 * branch. Both outputs are recorded in scripts/sim/reports/front-supply-2026-08-30.md.
 *
 * Runs the live front forward with the real engine and the real per-turn flows
 * (casualties applied, reinforcement, readiness drift), following the pattern in
 * frontCapacity2026-08-28.ts. Real naval and air support is applied to each side, as
 * the resolver does, so the supply figures are the ones a battle is fought at.
 *
 *   npx tsx scripts/sim/frontSupply2026-08-30.ts
 */
import { MongoClient } from "mongodb";
import * as dotenv from "dotenv";
import * as path from "path";
import type { Db } from "mongodb";
import type { MilitaryUnit } from "@/lib/db/types/militaryUnit";
import type { ConflictDoc } from "@/lib/db/types/conflict";
import { resolvePvpBattle, battleForecast, type BattleSide } from "@/lib/military/battle";
import { buildBattleSide } from "@/lib/military/battleSides";
import { conflictToFront } from "@/lib/military/createConflict";
import { occupationShift, derivedSupplies } from "@/lib/military/occupation";
import { reinforceUnit } from "@/lib/military/manpower";
import { READINESS_DRIFT_STEP, readinessBaselineOf } from "@/lib/military/readinessDrift";
import { loadNavairChannels } from "@/lib/db/collections/navairChannels";
import { frontSupportFor } from "@/lib/navair/frontSupport";
import type { NavairUnit } from "@/lib/navair/types";
import type { RegionCode } from "@/lib/military/types";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
let uri = process.env.MONGODB_URI_LIVE!;
if (!/directConnection=/.test(uri))
  uri += (uri.includes("?") ? "&" : "?") + "directConnection=true";

const THEATER = "war_us_dd_415";
const MAX_TURNS = 400;
const num = (x: number) => Math.round(x).toLocaleString("en-US");
const menOf = (us: MilitaryUnit[]) => us.reduce((a, u) => a + u.personnel, 0);

/** A Soviet Logistics command over the front at this effectiveness, for the variant. */
const RU_COMMAND_EFF = 0.7;

function upkeepTurn(units: MilitaryUnit[]) {
  return units.map((u) => {
    const r = reinforceUnit(u, "trained", Number.MAX_SAFE_INTEGER);
    const next = { ...u, personnel: r.personnel, vet: r.vet, xp: r.xp };
    const baseline = readinessBaselineOf(next.posture, 0, null);
    next.readiness = Math.min(baseline, next.readiness + READINESS_DRIFT_STEP);
    return next;
  });
}

async function main() {
  const client = new MongoClient(uri);
  await client.connect();
  try {
    const db = client.db() as unknown as Db;
    const conflict = (await db
      .collection("conflicts")
      .findOne({ _id: THEATER as never })) as unknown as ConflictDoc;
    const all = (await db
      .collection("militaryUnits")
      .find({ theaterId: THEATER })
      .toArray()) as unknown as MilitaryUnit[];
    const stationed = (await db
      .collection("militaryUnits")
      .find({ station: { $exists: true } })
      .toArray()) as unknown as NavairUnit[];
    const channels = await loadNavairChannels(db);

    const sideA = conflict.sideA.countries as string[];
    const sideB = conflict.sideB.countries as string[];
    const byCountry = new Map<string, MilitaryUnit[]>();
    for (const u of all)
      byCountry.set(String(u.countryId), [...(byCountry.get(String(u.countryId)) ?? []), u]);
    const rosterA = sideA.filter((c) => byCountry.has(c));
    const rosterB = sideB.filter((c) => byCountry.has(c));
    const region = conflict.region as RegionCode;
    const supportA = frontSupportFor(stationed, channels, rosterA, region);
    const supportB = frontSupportFor(stationed, channels, rosterB, region);

    // Doctrine, formations and generals are immutable across the run; load each
    // contingent once and swap only its units per turn.
    const template = new Map<string, BattleSide>();
    const front = conflictToFront(conflict);
    for (const c of byCountry.keys()) {
      const onA = sideA.includes(c);
      const sup = onA ? conflict.supplyA : conflict.supplyB;
      template.set(
        c,
        await buildBattleSide(
          db,
          c,
          byCountry.get(c) ?? [],
          { [THEATER]: front },
          sup,
          onA ? "A" : "B"
        )
      );
    }

    function sideAt(c: string, units: MilitaryUnit[], ruCommand: boolean): BattleSide {
      const base = template.get(c)!;
      const side = { ...base, units, fronts: { [THEATER]: front } } as BattleSide;
      if (ruCommand && c === "RU") {
        // Both field names, so the same script runs before and after the change: the
        // old engine read a flat throughput (20 x eff), the new one reads coverage.
        const withCmd = side as BattleSide & {
          logisticsSupplyByRegion?: Record<string, number>;
          logisticsCoverageByRegion?: Record<string, number>;
        };
        withCmd.logisticsSupplyByRegion = { [region]: Math.round(20 * RU_COMMAND_EFF) };
        withCmd.logisticsCoverageByRegion = { [region]: RU_COMMAND_EFF };
      }
      return side;
    }
    const sidesOf = (roster: string[], state: Map<string, MilitaryUnit[]>, ruCommand: boolean) =>
      roster.map((c) => sideAt(c, state.get(c) ?? [], ruCommand));

    console.log("======== ROSTERS ========");
    for (const [c, us] of byCountry)
      console.log(
        `${c.padEnd(3)} side ${sideA.includes(c) ? "A" : "B"}: ${String(us.length).padStart(2)} formations, ${num(menOf(us))} men`
      );
    console.log(
      `\ncontrol ${conflict.control.toFixed(2)} (start ${conflict.controlStart ?? 50}); supply A ${conflict.supplyA} / B ${conflict.supplyB}; host ${conflict.hostCountry}`
    );
    console.log(
      `navair: A air ${supportA.airSuperiority.toFixed(0)} sea ${supportA.seaControl.toFixed(0)} interdiction ${supportA.interdiction.toFixed(2)}` +
        ` | B air ${supportB.airSuperiority.toFixed(0)} sea ${supportB.seaControl.toFixed(0)} interdiction ${supportB.interdiction.toFixed(2)}\n`
    );

    // ---- 1. Opening supply, both directions ----
    console.log("======== OPENING SUPPLY (what each side fights at) ========");
    console.log(
      "variant                      | B attacking: level state    demand thr   eff  attr | A attacking: level state    demand thr   eff  attr | B atk | A atk"
    );
    const fmt = (s: {
      level: number;
      state: { l: string };
      demand: number;
      throughput: number;
      effMult: number;
      attrMult: number;
    }) =>
      `${String(s.level).padStart(3)} ${s.state.l.padEnd(8)} ${String(s.demand).padStart(5)} ${String(Math.round(s.throughput)).padStart(4)}  ${s.effMult.toFixed(2)} ${s.attrMult.toFixed(2)}`;
    const initial = new Map(byCountry);
    for (const ruCommand of [false, true]) {
      const B = sidesOf(rosterB, initial, ruCommand);
      const A = sidesOf(rosterA, initial, ruCommand);
      const bAtt = battleForecast(B, A, THEATER, supportB, supportA);
      const aAtt = battleForecast(A, B, THEATER, supportA, supportB);
      console.log(
        `${(ruCommand ? "RU Logistics command (0.7)" : "as deployed").padEnd(28)} | ${fmt(bAtt.attackerProfile.sup)} | ${fmt(aAtt.attackerProfile.sup)} |  ${String(bAtt.oddsPct).padStart(2)}%  |  ${String(aAtt.oddsPct).padStart(2)}%`
      );
    }

    // ---- 2. The war run forward ----
    async function runWar(attackerIsB: boolean, ruCommand: boolean) {
      let control = conflict.control;
      const state = new Map<string, MilitaryUnit[]>();
      for (const [c, us] of byCountry)
        state.set(
          c,
          us.map((u) => ({ ...u }))
        );
      let attDead = 0;
      let defDead = 0;
      let turn = 0;
      let ended: string | null = null;
      let supSum = 0;

      for (turn = 1; turn <= MAX_TURNS; turn++) {
        // Supply follows the line, as the resolver's does.
        const supNow = derivedSupplies({ ...conflict, control });
        const attRoster = attackerIsB ? rosterB : rosterA;
        const defRoster = attackerIsB ? rosterA : rosterB;
        const att = sidesOf(attRoster, state, ruCommand).map((s) => ({
          ...s,
          conflictSupply: attackerIsB ? supNow.supplyB : supNow.supplyA,
        }));
        const def = sidesOf(defRoster, state, ruCommand).map((s) => ({
          ...s,
          conflictSupply: attackerIsB ? supNow.supplyA : supNow.supplyB,
        }));
        if (att.every((s) => s.units.length === 0)) {
          ended = "attacker spent";
          break;
        }
        if (def.every((s) => s.units.length === 0)) {
          ended = "defender spent";
          break;
        }
        const r = resolvePvpBattle(
          att,
          def,
          THEATER,
          turn * 7919 + 13,
          attackerIsB ? supportB : supportA,
          attackerIsB ? supportA : supportB
        );
        supSum += battleForecast(
          att,
          def,
          THEATER,
          attackerIsB ? supportB : supportA,
          attackerIsB ? supportA : supportB
        ).attackerProfile.sup.level;
        attDead += r.attacker.loss;
        defDead += r.defender.loss;

        const cas = new Map<string, number>();
        const rd = new Map<string, number>();
        for (const u of [...r.attacker.unitResults, ...r.defender.unitResults]) {
          cas.set(u.id, (cas.get(u.id) ?? 0) + u.casualties);
          rd.set(u.id, u.readiness);
        }
        for (const [c, us] of state) {
          state.set(
            c,
            us
              .map((u) => {
                const id = String(u._id);
                return {
                  ...u,
                  personnel: Math.max(0, u.personnel - (cas.get(id) ?? 0)),
                  readiness: rd.has(id) ? rd.get(id)! : u.readiness,
                };
              })
              .filter((u) => u.personnel > 0)
          );
        }

        const winnerIsB = attackerIsB ? r.win : !r.win;
        control = occupationShift({
          control,
          winner: winnerIsB ? "B" : "A",
          margin: r.margin,
          loserRetreated: !!r.retreat,
        });
        if (control <= 0.01) {
          ended = `side A takes the map on turn ${turn}`;
          break;
        }
        if (control >= 99.99) {
          ended = `side B takes the map on turn ${turn}`;
          break;
        }
        for (const [c, us] of state) state.set(c, upkeepTurn(us));
      }
      const turns = Math.min(turn, MAX_TURNS);
      return { control, attDead, defDead, turn: turns, ended, avgSup: supSum / Math.max(1, turns) };
    }

    console.log(
      "\n\n======== THE WAR RUN FORWARD (one side presses every turn, trained refill) ========"
    );
    console.log(
      `starting control ${conflict.control.toFixed(2)}; side B wins at 100, side A at 0; cap ${MAX_TURNS} turns\n`
    );
    for (const ruCommand of [false, true]) {
      console.log(`--- ${ruCommand ? "with a Soviet Logistics command (0.7)" : "as deployed"} ---`);
      for (const attackerIsB of [true, false]) {
        const r = await runWar(attackerIsB, ruCommand);
        console.log(
          `  ${(attackerIsB ? "B presses" : "A presses").padEnd(10)} control ${r.control.toFixed(2).padStart(6)} after ${String(r.turn).padStart(3)} turns` +
            `  ·  attacker avg supply ${r.avgSup.toFixed(0).padStart(3)}` +
            `  ·  dead: att ${num(r.attDead).padStart(9)} / def ${num(r.defDead).padStart(9)}` +
            `  ·  ${r.ended ?? "NO RESOLUTION"}`
        );
      }
    }
  } finally {
    await client.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
