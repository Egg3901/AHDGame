/**
 * One-off: set every Japanese state's unemployment to a target %, refresh
 * `jp_national` via computeNationalMetrics, optionally set JP central bank prime rate,
 * and recalc JP inflation from current drivers.
 *
 * Usage:
 *   npx tsx scripts/set-jp-unemployment.ts
 *   npx tsx scripts/set-jp-unemployment.ts 4.5
 *   npx tsx scripts/set-jp-unemployment.ts 4 0.25
 *
 * Requires: MONGODB_URI in .env.local
 */

import { connectDb, closeDb } from "./utils/db";
import { computeNationalMetrics } from "../src/lib/nationalMetrics";
import { calculateCountryInflation } from "../src/lib/budget/inflation";
import type { CountryId } from "../src/lib/constants/countries";
import type { CentralBank } from "../src/lib/db/types/centralBank";
import type { FederalBudget } from "../src/lib/db/types/budget";
import type { GameState } from "../src/lib/db/types/gameState";
import type { State } from "../src/lib/db/types/state";
import type { StateMetrics } from "../src/lib/db/types/stateMetrics";

const JP: CountryId = "JP";

/** Prime rate must match in-game chair API: 0.25% increments, 0–25%. */
function normalizePrimeRate(raw: number): number {
  const clamped = Math.min(25, Math.max(0, raw));
  return Math.round(clamped * 4) / 4;
}

async function main() {
  const target = Math.min(30, Math.max(0, Number(process.argv[2]) || 4));
  const primeArg = process.argv[3];
  let primeRate: number | null = null;
  if (primeArg !== undefined && String(primeArg).trim() !== "") {
    const n = Number(primeArg);
    if (Number.isNaN(n)) {
      console.error("Invalid prime rate:", primeArg);
      process.exit(1);
    }
    primeRate = normalizePrimeRate(n);
  }

  const db = await connectDb();

  const jpStates = await db
    .collection<State>("states")
    .find({ countryId: JP, _id: { $not: /^NATIONAL_/ } })
    .project({ _id: 1, name: 1 })
    .toArray();

  if (jpStates.length === 0) {
    console.error("No JP states found.");
    await closeDb();
    process.exit(1);
  }

  const now = new Date();
  let updated = 0;

  for (const s of jpStates) {
    const r = await db.collection("stateMetrics").updateOne(
      { _id: s._id },
      {
        $set: {
          "economic.unemploymentRate.value": target,
          lastUpdated: now,
        },
      }
    );
    if (r.matchedCount === 0) {
      console.warn(`  No stateMetrics for state ${s._id} (${s.name ?? ""})`);
    } else {
      updated += r.modifiedCount;
    }
  }

  console.log(
    `Updated unemployment to ${target}% on ${jpStates.length} JP states (${updated} docs modified).`
  );

  await computeNationalMetrics(db);
  console.log("Recomputed national metrics (jp_national).");

  if (primeRate !== null) {
    const gs = await db.collection<GameState>("gameState").findOne({ _id: "current" });
    const turn = typeof gs?.currentTurn === "number" ? gs.currentTurn : 0;
    // Twelve identical snapshots so inflation's lagged effective rate ≈ spot (matches turn processor).
    const interestRateHistory = Array.from({ length: 12 }, (_, i) => ({
      turn: turn - 11 + i,
      rate: primeRate,
    }));

    await db.collection<CentralBank>("centralBanks").updateOne(
      { _id: JP },
      {
        $set: {
          primeRate: primeRate,
          interestRateHistory,
          updatedAt: now,
        },
      }
    );
    console.log(`JP central bank prime rate set to ${primeRate}% (interestRateHistory aligned).`);
  }

  const jpBudget = await db.collection<FederalBudget>("federalBudget").findOne({ _id: JP });
  if (jpBudget) {
    const newInflation = await calculateCountryInflation(db, JP, jpBudget);
    await db.collection<FederalBudget>("federalBudget").updateOne(
      { _id: JP },
      {
        $set: {
          "economicFactors.inflationRate": newInflation,
          "economicFactors.lastUpdated": now,
        },
      }
    );
    console.log(`JP inflation recalculated to ${newInflation}% (federalBudget.economicFactors).`);
  }

  const jpNat = await db.collection<StateMetrics>("stateMetrics").findOne({ _id: "jp_national" });
  const u = jpNat?.economic?.unemploymentRate?.value;
  console.log(`jp_national unemployment (weighted): ${u ?? "?"}`);

  await closeDb();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
