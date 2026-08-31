/**
 * Combat balance, part four: can this war ever actually END?
 *
 * Runs the German front forward turn by turn with the real engine and the real
 * per-turn flows -- casualties applied to units, reinforcement toward archetype
 * establishment, readiness drift -- and watches the control track.
 *
 *   npx tsx scripts/sim/combatBalance2026-08-27d.ts
 */
import { MongoClient } from "mongodb";
import * as dotenv from "dotenv";
import * as path from "path";
import type { Db } from "mongodb";
import type { MilitaryUnit } from "@/lib/db/types/militaryUnit";
import type { ConflictDoc } from "@/lib/db/types/conflict";
import { resolvePvpBattle, type BattleSide } from "@/lib/military/battle";
import { buildBattleSide } from "@/lib/military/battleSides";
import { conflictToFront } from "@/lib/military/createConflict";
import { occupationShift } from "@/lib/military/occupation";
import { reinforceUnit } from "@/lib/military/manpower";
import { READINESS_DRIFT_STEP, readinessBaselineOf } from "@/lib/military/readinessDrift";
import { getUnitArchetype } from "@/lib/constants/military";
import { ATTRITION } from "@/lib/military/config";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
let uri = process.env.MONGODB_URI_LIVE!;
if (!/directConnection=/.test(uri))
  uri += (uri.includes("?") ? "&" : "?") + "directConnection=true";

const THEATER = "war_us_dd_415";
const MAX_TURNS = 400;
const num = (x: number) => Math.round(x).toLocaleString("en-US");

const menOf = (us: MilitaryUnit[]) => us.reduce((a, u) => a + u.personnel, 0);

/** One turn of the per-turn flows every surviving formation goes through. */
function upkeepTurn(units: MilitaryUnit[], reinforce: "trained" | "conscript" | "off") {
  return units.map((u) => {
    let next = { ...u };
    if (reinforce !== "off") {
      // Pool assumed ample: this is the most GENEROUS case for ending the war by
      // attrition, so a stalemate here is a stalemate under any manpower policy.
      const r = reinforceUnit(next, reinforce, Number.MAX_SAFE_INTEGER);
      next = { ...next, personnel: r.personnel, vet: r.vet, xp: r.xp };
    }
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
    const fronts = { [THEATER]: conflictToFront(conflict) };
    const all = (await db
      .collection("militaryUnits")
      .find({ theaterId: THEATER })
      .toArray()) as unknown as MilitaryUnit[];
    const byCountry = new Map<string, MilitaryUnit[]>();
    for (const u of all)
      byCountry.set(String(u.countryId), [...(byCountry.get(String(u.countryId)) ?? []), u]);

    console.log("======== TRUE ESTABLISHMENT (from the archetype table) ========");
    for (const [c, us] of byCountry) {
      const est = us.reduce((a, u) => a + (getUnitArchetype(u.domain, u.type)?.personnel ?? 0), 0);
      const men = menOf(us);
      console.log(
        `${c}: present ${num(men)} / establishment ${num(est)} (${((men / est) * 100).toFixed(0)}% strength)` +
          `  refill/turn trained ${num(est * ATTRITION.trainedFillRatio)} · conscript ${num(est * ATTRITION.conscriptFillRatio)}`
      );
    }

    const mk = (c: string, us: MilitaryUnit[], side: "A" | "B", sup: number) =>
      buildBattleSide(db, c, us, fronts, sup, side);

    /**
     * Run the war forward. `attackers` press every turn; the defender only defends,
     * which is the pattern the live war has actually followed.
     */
    async function runWar(
      label: string,
      attackerCountries: string[],
      reinforce: "trained" | "conscript" | "off"
    ) {
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
      const marks: string[] = [];

      for (turn = 1; turn <= MAX_TURNS; turn++) {
        const attSides: BattleSide[] = [];
        for (const c of attackerCountries) {
          attSides.push(await mk(c, state.get(c) ?? [], "B", conflict.supplyB));
        }
        const defSide = await mk("US", state.get("US") ?? [], "A", conflict.supplyA);
        if (attSides.every((s) => s.units.length === 0)) {
          ended = `attacker has no formations left`;
          break;
        }
        if (defSide.units.length === 0) {
          ended = `defender has no formations left`;
          break;
        }

        const r = resolvePvpBattle(attSides, [defSide], THEATER, turn * 7919 + 13);
        attDead += r.attacker.loss;
        defDead += r.defender.loss;

        // Casualties onto the live formations, by unit id.
        const cas = new Map<string, number>();
        for (const u of [...r.attacker.unitResults, ...r.defender.unitResults]) {
          cas.set(u.id, (cas.get(u.id) ?? 0) + u.casualties);
        }
        const rd = new Map<string, number>();
        for (const u of [...r.attacker.unitResults, ...r.defender.unitResults])
          rd.set(u.id, u.readiness);
        for (const [c, us] of state) {
          state.set(
            c,
            us
              .map((u) => {
                const id = String(u._id);
                const lost = cas.get(id) ?? 0;
                return {
                  ...u,
                  personnel: Math.max(0, u.personnel - lost),
                  readiness: rd.has(id) ? rd.get(id)! : u.readiness,
                };
              })
              // A formation with nobody left is gone.
              .filter((u) => u.personnel > 0)
          );
        }

        const winner = r.win ? "B" : "A";
        control = occupationShift({
          control,
          winner,
          margin: r.margin,
          loserRetreated: !!r.retreat,
        });

        if (turn <= 5 || turn % 50 === 0) {
          marks.push(
            `    t+${String(turn).padStart(3)}  control ${control.toFixed(2)}  ` +
              `att ${num(menOf([...state.values()].flat().filter((u) => attackerCountries.includes(String(u.countryId)))))} men  ` +
              `def ${num(menOf(state.get("US") ?? []))} men`
          );
        }

        if (control <= 0.01) {
          ended = `side A (US) took the map on turn ${turn}`;
          break;
        }
        if (control >= 99.99) {
          ended = `side B (${attackerCountries.join("+")}) took the map on turn ${turn}`;
          break;
        }

        for (const [c, us] of state) state.set(c, upkeepTurn(us, reinforce));
      }

      console.log(`\n### ${label}   [reinforcement: ${reinforce}]`);
      for (const m of marks) console.log(m);
      console.log(
        `    after ${turn > MAX_TURNS ? MAX_TURNS : turn} turns: control ${control.toFixed(2)} ` +
          `(started ${conflict.control.toFixed(2)}, net ${control - conflict.control >= 0 ? "+" : ""}${(control - conflict.control).toFixed(2)})`
      );
      console.log(`    cumulative dead: attacker ${num(attDead)} · defender ${num(defDead)}`);
      console.log(`    outcome: ${ended ?? `NO RESOLUTION in ${MAX_TURNS} turns`}`);
    }

    console.log("\n\n======== THE WAR, RUN FORWARD ========");
    console.log(`starting control ${conflict.control.toFixed(2)}; a side wins at 0 or 100.`);
    await runWar("DD attacks every turn", ["DD"], "trained");
    await runWar("DD + RU attack every turn", ["DD", "RU"], "trained");
    await runWar("DD attacks every turn, NO reinforcement", ["DD"], "off");
    await runWar("DD + RU attack every turn, NO reinforcement", ["DD", "RU"], "off");
    await runWar("DD + RU attack every turn, conscript refill", ["DD", "RU"], "conscript");
  } finally {
    await client.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
