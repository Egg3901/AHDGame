/**
 * Re-deriving FRONT_CAPACITY_BASE after frontage stopped being billed in combat value.
 *
 * Three engine changes landed before this run, and all three move the number:
 *
 *  - `applyOutcome` used to persist the readiness DROP rather than the level a battle
 *    left, which pinned every formation in the game to single digits. Readiness now
 *    recovers, and a recovered force is worth more per formation.
 *  - Frontage is billed by `frontageCost` (combat value WITHOUT the readiness curve),
 *    so the line no longer shrinks as an army rests. The unit the constant is
 *    denominated in has changed, which is why it has to be re-derived at all.
 *  - Supply reads depth from the engagement plan and counts it only up to the size of
 *    the line it feeds, so a large reserve no longer buys free throughput.
 *
 * The question this answers is not "who wins" but "does the size of an army show up in
 * the result at all". At 900 it does not: the Soviet Army fights WORSE alone than East
 * Germany does, because a CV-denominated cap charged it for the quality of its
 * divisions. The candidate is the smallest frontage at which force size orders the
 * outcome the way a player would expect.
 *
 * Runs the live German front forward with the real engine and the real per-turn flows
 * (casualties applied, reinforcement, readiness drift), following the pattern in
 * combatBalance2026-08-27d.ts.
 *
 *   npx tsx scripts/sim/frontCapacity2026-08-28.ts
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
import { occupationShift } from "@/lib/military/occupation";
import { reinforceUnit } from "@/lib/military/manpower";
import { READINESS_DRIFT_STEP, readinessBaselineOf } from "@/lib/military/readinessDrift";
import { FRONT_CAPACITY_BASE } from "@/lib/military/config";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
let uri = process.env.MONGODB_URI_LIVE!;
if (!/directConnection=/.test(uri))
  uri += (uri.includes("?") ? "&" : "?") + "directConnection=true";

const THEATER = "war_us_dd_415";
const MAX_TURNS = 400;
/** Candidates, plus the shipped value as the control. */
const CANDIDATES = [FRONT_CAPACITY_BASE, 2400, 4000, 6000, 8000, 10000];
const num = (x: number) => Math.round(x).toLocaleString("en-US");
const menOf = (us: MilitaryUnit[]) => us.reduce((a, u) => a + u.personnel, 0);

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
    const byCountry = new Map<string, MilitaryUnit[]>();
    for (const u of all)
      byCountry.set(String(u.countryId), [...(byCountry.get(String(u.countryId)) ?? []), u]);

    // Doctrine, formations and generals are immutable across the run; load each
    // contingent once and swap only its units per turn.
    const template = new Map<string, BattleSide>();
    for (const c of byCountry.keys()) {
      const sup = c === "US" ? conflict.supplyA : conflict.supplyB;
      template.set(
        c,
        await buildBattleSide(db, c, byCountry.get(c) ?? [], {}, sup, c === "US" ? "A" : "B")
      );
    }

    function sideAt(c: string, units: MilitaryUnit[], capacity: number): BattleSide {
      const front = { ...conflictToFront(conflict), capacity };
      return { ...template.get(c)!, units, fronts: { [THEATER]: front } } as BattleSide;
    }

    console.log("======== ROSTERS ========");
    for (const [c, us] of byCountry)
      console.log(`${c}: ${us.length} formations, ${num(menOf(us))} men`);
    console.log(
      `\nshipped FRONT_CAPACITY_BASE = ${FRONT_CAPACITY_BASE}; this front is temperate (x1.0)\n`
    );

    // ---- 1. Does force size order the outcome? ----
    console.log(
      "======== DOES ARMY SIZE ORDER THE RESULT? (opening odds, side B attacking) ========"
    );
    console.log(
      "A sane curve reads DD alone < RU alone < DD+RU. At the shipped value it does not.\n"
    );
    console.log("frontage    DD alone   RU alone   DD+RU    ordering        RU in line");
    for (const cap of CANDIDATES) {
      const cells: number[] = [];
      let ruLine = 0;
      for (const roster of [["DD"], ["RU"], ["DD", "RU"]]) {
        const att = roster.map((c) => sideAt(c, byCountry.get(c) ?? [], cap));
        const def = [sideAt("US", byCountry.get("US") ?? [], cap)];
        const f = battleForecast(att, def, THEATER);
        cells.push(f.oddsPct);
        if (roster.length === 1 && roster[0] === "RU") ruLine = f.attackerPlan.inContact.size;
      }
      const sane = cells[0] < cells[1] && cells[1] < cells[2];
      console.log(
        `${String(cap).padStart(8)}      ${String(cells[0]).padStart(3)}%       ${String(cells[1]).padStart(3)}%    ${String(cells[2]).padStart(3)}%` +
          `    ${(sane ? "sensible" : "INVERTED").padEnd(14)}  ${ruLine}/44`
      );
    }

    // ---- 2. Can the war end, and at what cost? ----
    async function runWar(cap: number, attackerCountries: string[]) {
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

      for (turn = 1; turn <= MAX_TURNS; turn++) {
        const attSides = attackerCountries.map((c) => sideAt(c, state.get(c) ?? [], cap));
        const defSide = sideAt("US", state.get("US") ?? [], cap);
        if (attSides.every((s) => s.units.length === 0)) {
          ended = "attacker spent";
          break;
        }
        if (defSide.units.length === 0) {
          ended = "defender spent";
          break;
        }

        const r = resolvePvpBattle(attSides, [defSide], THEATER, turn * 7919 + 13);
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

        control = occupationShift({
          control,
          winner: r.win ? "B" : "A",
          margin: r.margin,
          loserRetreated: !!r.retreat,
        });
        if (control <= 0.01) {
          ended = `US takes the map on turn ${turn}`;
          break;
        }
        if (control >= 99.99) {
          ended = `${attackerCountries.join("+")} takes the map on turn ${turn}`;
          break;
        }

        for (const [c, us] of state) state.set(c, upkeepTurn(us));
      }
      return { control, attDead, defDead, turn: Math.min(turn, MAX_TURNS), ended };
    }

    console.log(
      "\n\n======== THE WAR RUN FORWARD (side B presses every turn, trained refill) ========"
    );
    console.log(
      `starting control ${conflict.control.toFixed(2)}; a side wins at 0 or 100; cap ${MAX_TURNS} turns\n`
    );
    for (const cap of CANDIDATES) {
      console.log(`--- frontage ${cap} ---`);
      for (const roster of [["DD"], ["DD", "RU"]]) {
        const r = await runWar(cap, roster);
        console.log(
          `  ${roster.join("+").padEnd(6)} control ${r.control.toFixed(2).padStart(6)} after ${String(r.turn).padStart(3)} turns` +
            `  ·  dead: B ${num(r.attDead).padStart(9)} / US ${num(r.defDead).padStart(9)}` +
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
