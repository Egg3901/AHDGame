/**
 * Intelligence sabotage balance report: what does one covert operation buy?
 *
 * The balance gate for `SABOTAGE_SUPPLY_POINTS` and `SABOTAGE_READINESS_POINTS`
 * (src/lib/intelligence/config.ts). Both are phase 3 constants that move real
 * battle outcomes, so they may not ship on judgement alone.
 *
 * WHAT IS REAL AND WHAT IS RECONSTRUCTED. Verified against the live world on
 * 2026-08-31: ONE conflict (`war_us_dd_415`), already resolved; ZERO conflict
 * assignments; all 369 formations in `reserve`. So this is NOT a live replay,
 * and must not be read as one.
 *
 * Real: every formation and its `basePower`, `readiness`, `posture`, `vet` and
 * `assignedGeneralId`; the 38 commissioned generals and their stats; the two
 * coalition rosters; the conflict's own supply bases and control.
 *
 * Reconstructed: the theatre POSTINGS only. The war ended, so no general is
 * posted anywhere, and with nobody posted no formation engages and every arm
 * reads a flat zero. Each side's existing generals are therefore posted to the
 * theatre IN MEMORY. Nothing is written to the live database.
 *
 * TWO ARMS:
 *   SUPPLY     side B's supply base cut by SABOTAGE_SUPPLY_POINTS, everything
 *              else held. Supply is a `buildCoalitionSide` input, so this is the
 *              arm that can move who wins.
 *   READINESS  side B's readiest SABOTAGE_UNIT_COUNT formations cut by
 *              SABOTAGE_READINESS_POINTS. Readiness does NOT enter `basePower`
 *              and so cannot move the odds; it feeds `unitOutcomes`' depletion
 *              term, which makes a worn formation wear out FASTER. Measured here
 *              to prove the effect is real and to size it honestly.
 *
 *   npx tsx scripts/sim/intelligenceSabotage2026-08-31.ts
 */
import { MongoClient } from "mongodb";
import * as dotenv from "dotenv";
import * as path from "path";
import type { Db } from "mongodb";
import type { MilitaryUnit } from "@/lib/db/types/militaryUnit";
import type { ConflictDoc } from "@/lib/db/types/conflict";
import { resolvePvpBattle, type BattleSide } from "@/lib/military/battle";
import { buildCoalitionSide } from "@/lib/military/battleSides";
import { conflictToFront } from "@/lib/military/createConflict";
import { derivedSupplies } from "@/lib/military/occupation";
import {
  SABOTAGE_READINESS_POINTS,
  SABOTAGE_SUPPLY_POINTS,
  SABOTAGE_UNIT_COUNT,
} from "@/lib/intelligence/config";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
let uri = process.env.MONGODB_URI_LIVE!;
if (!/directConnection=/.test(uri))
  uri += (uri.includes("?") ? "&" : "?") + "directConnection=true";

const THEATER = process.env.SIM_THEATER ?? "war_us_dd_415";
const TRIALS = Number(process.env.SIM_TRIALS ?? 600);
const pct = (n: number) => (n * 100).toFixed(1) + "%";

interface Arm {
  wins: number;
  retreats: number;
  attackerLoss: number;
  defenderLoss: number;
  verdicts: Record<string, number>;
}

function emptyArm(): Arm {
  return { wins: 0, retreats: 0, attackerLoss: 0, defenderLoss: 0, verdicts: {} };
}

function fight(a: BattleSide[], d: BattleSide[], trials: number): Arm {
  const arm = emptyArm();
  for (let s = 0; s < trials; s++) {
    const r = resolvePvpBattle(a, d, THEATER, s * 7919);
    if (r.win) arm.wins++;
    if (r.retreat) arm.retreats++;
    arm.attackerLoss += r.attacker.loss;
    arm.defenderLoss += r.defender.loss;
    arm.verdicts[r.verdict] = (arm.verdicts[r.verdict] ?? 0) + 1;
  }
  return arm;
}

function report(name: string, arm: Arm, trials: number) {
  console.log(
    `${name.padEnd(22)} attackerWin ${pct(arm.wins / trials).padStart(6)}  ` +
      `retreat ${pct(arm.retreats / trials).padStart(6)}  ` +
      `atkLoss ${(arm.attackerLoss / trials).toFixed(0).padStart(6)}  ` +
      `defLoss ${(arm.defenderLoss / trials).toFixed(0).padStart(6)}`
  );
}

const formations = (sides: BattleSide[]) => sides.reduce((a, s) => a + s.units.length, 0);
const posted = (sides: BattleSide[]) => sides.reduce((a, s) => a + s.assignments.length, 0);

/** Cut the readiest N formations, which is where a sabotage team would go. */
function degradeReadiest(units: MilitaryUnit[], count: number, points: number): MilitaryUnit[] {
  const order = [...units].sort((x, y) => y.readiness - x.readiness);
  const hit = new Set(order.slice(0, count).map((u) => String(u._id)));
  return units.map((u) =>
    hit.has(String(u._id)) ? { ...u, readiness: Math.max(0, u.readiness - points) } : u
  );
}

async function main() {
  const client = new MongoClient(uri);
  await client.connect();
  try {
    const db = client.db() as unknown as Db;
    const conflict = (await db
      .collection("conflicts")
      .findOne({ _id: THEATER as never })) as unknown as ConflictDoc;
    if (!conflict) throw new Error(`No conflict ${THEATER}`);

    const fronts = { [THEATER]: conflictToFront(conflict) };

    // Every formation in the world, partitioned by country. Partitioning first
    // is load-bearing, not tidiness: `buildBattleSide` does NOT filter what it
    // is handed, so passing the whole set would put every belligerent on BOTH
    // sides and quietly measure an army fighting itself.
    const units = (await db
      .collection("militaryUnits")
      .find({})
      .toArray()) as unknown as MilitaryUnit[];
    const byCountry = new Map<string, MilitaryUnit[]>();
    for (const u of units) {
      byCountry.set(String(u.countryId), [...(byCountry.get(String(u.countryId)) ?? []), u]);
    }

    const west = conflict.sideA.countries.filter((c) => byCountry.get(c)?.length);
    const east = conflict.sideB.countries.filter((c) => byCountry.get(c)?.length);

    // Supply as the game would actually derive it, from the seeded bases and the
    // front's displacement. Writing the derived reading is exactly the mistake
    // this feature had to avoid, so the report measures the same path.
    const baseline = derivedSupplies(conflict);
    const sabotagedConflict = {
      ...conflict,
      supplyBaseB: Math.max(0, (conflict.supplyBaseB ?? conflict.supplyB) - SABOTAGE_SUPPLY_POINTS),
    };
    const afterSupply = derivedSupplies(sabotagedConflict);

    console.log(`Front ${THEATER} (reconstructed from ${units.length} real formations)`);
    console.log(`  West: ${west.join(", ") || "(none)"}`);
    console.log(`  East: ${east.join(", ") || "(none)"}`);
    console.log(
      `  supplyB baseline ${baseline.supplyB} -> sabotaged ${afterSupply.supplyB} ` +
        `(base cut ${SABOTAGE_SUPPLY_POINTS})`
    );
    console.log(`  trials ${TRIALS}\n`);

    /**
     * Post each side's real generals to the theatre, in memory.
     *
     * A formation engages only when its `assignedGeneralId` names a general who
     * holds a `ConflictAssignment` at this theatre. The war is over, so nobody
     * holds one, and without this every arm reads a flat zero with no casualties
     * on either side - which is a broken harness, not a finding.
     */
    const postGenerals = (sides: BattleSide[], unitsFor: Map<string, MilitaryUnit[]>) =>
      sides.map((s) => {
        const generals = [
          ...new Set(
            (unitsFor.get(s.country) ?? [])
              .map((u) => u.assignedGeneralId)
              .filter((g): g is string => !!g)
          ),
        ];
        return {
          ...s,
          assignments: generals.map((generalCharacterId, i) => ({
            theaterId: THEATER,
            generalCharacterId,
            inCharge: i === 0,
          })),
        };
      });

    const attacker = postGenerals(
      await buildCoalitionSide(db, west, byCountry, fronts, baseline.supplyA, "A"),
      byCountry
    );

    // ── Arm 1: supply ──────────────────────────────────────────────────────
    const defBaseline = postGenerals(
      await buildCoalitionSide(db, east, byCountry, fronts, baseline.supplyB, "B"),
      byCountry
    );
    const defSupplyCut = postGenerals(
      await buildCoalitionSide(db, east, byCountry, fronts, afterSupply.supplyB, "B"),
      byCountry
    );

    console.log(
      `  attacker ${formations(attacker)} formations / ${posted(attacker)} generals posted; ` +
        `defender ${formations(defBaseline)} / ${posted(defBaseline)}
`
    );

    const armBaseline = fight(attacker, defBaseline, TRIALS);
    const armSupply = fight(attacker, defSupplyCut, TRIALS);

    // ── Arm 2: readiness ───────────────────────────────────────────────────
    const degraded = new Map(byCountry);
    for (const c of east) {
      degraded.set(
        c,
        degradeReadiest(byCountry.get(c) ?? [], SABOTAGE_UNIT_COUNT, SABOTAGE_READINESS_POINTS)
      );
    }
    const defReadinessCut = postGenerals(
      await buildCoalitionSide(db, east, degraded, fronts, baseline.supplyB, "B"),
      degraded
    );
    const armReadiness = fight(attacker, defReadinessCut, TRIALS);

    report("BASELINE", armBaseline, TRIALS);
    report("SUPPLY sabotage", armSupply, TRIALS);
    report("READINESS sabotage", armReadiness, TRIALS);

    const swing = (armSupply.wins - armBaseline.wins) / TRIALS;
    const readinessSwing = (armReadiness.wins - armBaseline.wins) / TRIALS;
    console.log(`\nAttacker win swing from ONE supply sabotage:    ${(swing * 100).toFixed(1)}pp`);
    console.log(
      `Attacker win swing from ONE readiness sabotage: ${(readinessSwing * 100).toFixed(1)}pp ` +
        `(expected ~0: readiness is not a basePower input)`
    );
  } finally {
    await client.close();
  }
}

main().catch((e) => {
  console.error("FAILED", e);
  process.exit(1);
});
