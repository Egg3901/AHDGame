/**
 * The readiness ledger: what a battle spends, and how long the refill takes.
 *
 * Post-battle readiness is not a subtraction. `unitOutcomes` SETS it:
 *   readiness = max(3, min(current, round((12 + (1-ratio)*22 + rand*8) * armorMit * min(1.2, roleCas))))
 * so a formation is knocked to an absolute floor in a single engagement regardless of
 * where it started, and `min(current, ...)` means it can only ever ratchet down.
 *
 * Recovery is READINESS_DRIFT_STEP (4) per turn toward a POSTURE baseline
 * (garrison 60 / standard 72 / forward 84 / alert 92) -- never toward 100.
 *
 *   npx tsx scripts/sim/readinessEconomy.ts
 */
import { MongoClient } from "mongodb";
import * as dotenv from "dotenv";
import * as path from "path";
import type { Db } from "mongodb";
import type { MilitaryUnit } from "@/lib/db/types/militaryUnit";
import type { ConflictDoc } from "@/lib/db/types/conflict";
import { resolvePvpBattle } from "@/lib/military/battle";
import { buildBattleSide } from "@/lib/military/battleSides";
import { conflictToFront } from "@/lib/military/createConflict";
import { occupationShift } from "@/lib/military/occupation";
import { recommendRole } from "@/lib/military/combat";
import { READINESS_DRIFT_STEP, readinessBaselineOf } from "@/lib/military/readinessDrift";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
let uri = process.env.MONGODB_URI_LIVE!;
if (!/directConnection=/.test(uri))
  uri += (uri.includes("?") ? "&" : "?") + "directConnection=true";

const THEATER = "war_us_dd_415";
const SEEDS = 300;
const one = (x: number) => x.toFixed(1);

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
    const by = (c: string) => all.filter((u) => String(u.countryId) === c);

    console.log("======== WHERE THE LIVE ARMIES ACTUALLY SIT ========\n");
    console.log("country | unit | posture | baseline | readiness | gap | turns to baseline");
    for (const c of ["DD", "US", "RU"]) {
      for (const u of by(c)) {
        const base = readinessBaselineOf(u.posture, 0, null);
        const gap = base - u.readiness;
        console.log(
          `${c} | ${u.type.padEnd(26)} | ${String(u.posture).padEnd(9)} | ${String(base).padStart(3)} | ` +
            `${String(u.readiness).padStart(3)} | ${String(gap).padStart(4)} | ${gap > 0 ? Math.ceil(gap / READINESS_DRIFT_STEP) : 0}`
        );
      }
    }

    console.log("\n\n======== WHAT ONE BATTLE SPENDS ========");
    console.log("every formation reset to its posture baseline, then made to fight once.\n");
    const rested = (us: MilitaryUnit[]) =>
      us.map((u) => ({ ...u, readiness: readinessBaselineOf(u.posture, 0, null) }));

    const ddR = await buildBattleSide(db, "DD", rested(by("DD")), fronts, conflict.supplyB, "B");
    const usR = await buildBattleSide(db, "US", rested(by("US")), fronts, conflict.supplyA, "A");

    const after: Record<string, number[]> = {};
    for (let i = 0; i < SEEDS; i++) {
      const r = resolvePvpBattle([ddR], [usR], THEATER, i * 7919 + 13);
      for (const u of [...r.attacker.unitResults, ...r.defender.unitResults]) {
        (after[u.id] ??= []).push(u.readiness);
      }
    }
    console.log("country | unit | role | baseline | after one battle | spent | turns to refill");
    let spentTot = 0,
      turnsTot = 0,
      n = 0;
    for (const c of ["DD", "US"]) {
      for (const u of by(c)) {
        const xs = after[String(u._id)];
        if (!xs) continue;
        const base = readinessBaselineOf(u.posture, 0, null);
        const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
        const spent = base - mean;
        const turns = spent / READINESS_DRIFT_STEP;
        spentTot += spent;
        turnsTot += turns;
        n++;
        console.log(
          `${c} | ${u.type.padEnd(26)} | ${recommendRole(u).padEnd(10)} | ${String(base).padStart(3)} | ` +
            `${one(mean).padStart(5)} | ${one(spent).padStart(5)} | ${one(turns).padStart(5)}`
        );
      }
    }
    console.log(
      `\nmean across ${n} formations: ${one(spentTot / n)} readiness spent per engagement, ` +
        `${one(turnsTot / n)} turns to refill at ${READINESS_DRIFT_STEP}/turn.`
    );

    console.log("\n\n======== THE CYCLE: ATTACK EVERY N TURNS ========");
    console.log("readiness carried forward between engagements, recovering 4/turn in the gaps.\n");
    for (const gap of [1, 2, 4, 8, 13, 20]) {
      let units = rested(by("DD"));
      // The defender is worn down by defending, so it must carry readiness forward too.
      // Holding it fresh would invent a penalty the attacker does not actually face.
      let usUnits = rested(by("US"));
      let wins = 0,
        ground = 0,
        dead = 0;
      const BATTLES = 12;
      const rdAt: number[] = [];
      for (let b = 0; b < BATTLES; b++) {
        const side = await buildBattleSide(db, "DD", units, fronts, conflict.supplyB, "B");
        const usSide = await buildBattleSide(db, "US", usUnits, fronts, conflict.supplyA, "A");
        rdAt.push(units.reduce((a, u) => a + u.readiness, 0) / units.length);
        const r = resolvePvpBattle([side], [usSide], THEATER, (b + 1) * 7919 + 13);
        if (r.win) wins++;
        dead += r.attacker.loss;
        const next = occupationShift({
          control: 50,
          winner: r.win ? "B" : "A",
          margin: r.margin,
          loserRetreated: !!r.retreat,
        });
        ground += r.win ? next - 50 : -(50 - next);
        const rd = new Map(
          [...r.attacker.unitResults, ...r.defender.unitResults].map((u) => [u.id, u.readiness])
        );
        const carry = (us: MilitaryUnit[]) =>
          us.map((u) => {
            const hit = rd.get(String(u._id));
            let next2 = hit ?? u.readiness;
            const base = readinessBaselineOf(u.posture, 0, null);
            for (let t = 0; t < gap; t++) next2 = Math.min(base, next2 + READINESS_DRIFT_STEP);
            return { ...u, readiness: next2 };
          });
        units = carry(units);
        usUnits = carry(usUnits);
      }
      const turns = BATTLES * gap;
      console.log(
        `attack every ${String(gap).padStart(2)} turns  att readiness ${one(rdAt.reduce((a, b) => a + b, 0) / rdAt.length).padStart(5)}  ` +
          `def readiness ${one(usUnits.reduce((a, u) => a + u.readiness, 0) / usUnits.length).padStart(5)}  ` +
          `win ${String(Math.round((wins / BATTLES) * 100)).padStart(3)}%  ` +
          `ground ${ground >= 0 ? "+" : ""}${one(ground).padStart(5)} over ${String(turns).padStart(3)} turns  ` +
          `= ${one((ground / turns) * 100).padStart(5)} pts/100 turns  dead ${Math.round(dead).toLocaleString("en-US")}`
      );
    }
  } finally {
    await client.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
