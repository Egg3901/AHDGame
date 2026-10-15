/**
 * Seed base policy records for the nation and each state.
 * Non-destructive by default: upserts into statePolicies. Use --reset to drop and re-seed.
 *
 * Usage:
 *   npx tsx scripts/seed-policies.ts           # Upsert all policy records
 *   npx tsx scripts/seed-policies.ts --reset   # Drop statePolicies and re-seed
 */

import { connectDb, closeDb } from "../utils/db";
import { getBasePolicies } from "../seeds/basePolicies";
import { getGameStatePresetOrDefault } from "../../src/lib/db/collections/gameState";
import type { StatePolicyRecord, FederalBudget, LegislationType } from "../../src/lib/db/types";
import {
  alignIncomeTaxPolicyRecords,
  INCOME_TAX_POLICY_JURISDICTIONS,
} from "../../src/lib/budget/rules/incomeTaxPolicy";

const RESET = process.argv.includes("--reset");

/**
 * Deprecated legislation type IDs to delete when reseeding.
 * These were replaced or restructured in the legislation rework.
 */
const DEPRECATED_TYPE_IDS = [
  "immigration", // Split into border_security_enforcement + legal_immigration_visas
  "medicare", // Redundant with federal_healthcare_funding and drug_pricing_medicare
];

async function main() {
  console.log("Seed: Base Policies\n");

  const db = await connectDb();

  try {
    const authoredPolicies = await getBasePolicies(await getGameStatePresetOrDefault(db));
    // Standalone policy seeding does not reset budgets: retain current rates and pending targets.
    const [budgets, taxTypes] = await Promise.all([
      db
        .collection<FederalBudget>("federalBudget")
        .find(
          { countryId: { $in: ["BR", "NG"] } },
          { projection: { countryId: 1, "taxRates.incomeTax": 1, "taxRatePhaseIn.incomeTax": 1 } }
        )
        .toArray(),
      db
        .collection<LegislationType>("legislationTypes")
        .find(
          { _id: { $in: INCOME_TAX_POLICY_JURISDICTIONS.map((entry) => entry.legislationTypeId) } },
          { projection: { "policyOptions.id": 1, "policyOptions.rate": 1 } }
        )
        .toArray(),
    ]);
    const basePolicies = alignIncomeTaxPolicyRecords(authoredPolicies, budgets, taxTypes);
    if (RESET) {
      await db
        .collection("statePolicies")
        .drop()
        .catch(() => {});
      console.log("Dropped statePolicies collection.");
    }

    const coll = db.collection<StatePolicyRecord>("statePolicies");

    // Delete policy records for deprecated legislation types
    if (DEPRECATED_TYPE_IDS.length > 0) {
      const deleteResult = await coll.deleteMany({
        legislationTypeId: { $in: DEPRECATED_TYPE_IDS },
      });
      if (deleteResult.deletedCount > 0) {
        console.log(
          `Deleted ${deleteResult.deletedCount} policy records for deprecated legislation types.`
        );
      }
    }

    for (const r of basePolicies) {
      const filter =
        r.scope === "national"
          ? { scope: "national" as const, legislationTypeId: r.legislationTypeId }
          : { scope: "state" as const, stateId: r.stateId, legislationTypeId: r.legislationTypeId };
      const setDoc = {
        scope: r.scope,
        ...(r.stateId != null && { stateId: r.stateId }),
        legislationTypeId: r.legislationTypeId,
        economic: r.economic,
        social: r.social,
        ...(r.policyOptionId != null && { policyOptionId: r.policyOptionId }),
        ...(r.policyOptionIndex != null && { policyOptionIndex: r.policyOptionIndex }),
        effectDirection: r.effectDirection,
        updatedAt: r.updatedAt,
      };
      await coll.updateOne(filter, { $set: setDoc }, { upsert: true });
    }

    const count = await coll.countDocuments();
    console.log(`Upserted ${basePolicies.length} policy records (total in collection: ${count}).`);
    console.log("\nDone. Run seed:policies separately from the main seed.");
  } finally {
    await closeDb();
  }
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
