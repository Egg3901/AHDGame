/**
 * Seed legislation types and optionally reset committee assignments.
 * Non-destructive: only upserts legislationTypes (and optionally clears committeeAssignments).
 * Does not touch states, parties, users, characters, or other collections.
 *
 * Usage:
 *   npx tsx scripts/seed-legislation.ts           # Upsert all legislation types
 *   npx tsx scripts/seed-legislation.ts --reset-committees  # Also clear committee assignments
 */

import { connectDb, closeDb } from "../utils/db";
import { legislationTypes } from "../seeds/legislationTypes";
import type { LegislationType } from "../../src/lib/db/types";

const RESET_COMMITTEES = process.argv.includes("--reset-committees");

/**
 * Deprecated legislation type IDs to delete when reseeding.
 * These were replaced or restructured in the legislation rework.
 */
const DEPRECATED_TYPE_IDS = [
  "immigration", // Split into border_security_enforcement + legal_immigration_visas
  "medicare", // Redundant with federal_healthcare_funding and drug_pricing_medicare
  "uk_brexit_trade", // Post-Brexit starting point; no longer a live policy debate
  "uk_scottish_devolution", // Replaced by broader uk_devolution_local_powers
  "uk_nhs_social_care", // Split into uk_social_care and uk_mental_health
  "uk_hs2_rail", // Absorbed into broader uk_transport_rail
  "uk_defense_spending", // Replaced by uk_defence_spending (UK English spelling)
  "uk_immigration", // Split into uk_immigration_asylum and uk_work_visas
  "uk_bbc_licence_fee", // Replaced by uk_bbc_public_media (broader scope)
  "uk_local_government", // Replaced by uk_local_government_funding (clearer name)
];

async function main() {
  console.log("Seed: Legislation & Committees\n");

  const db = await connectDb();

  try {
    // Delete deprecated legislation types
    if (DEPRECATED_TYPE_IDS.length > 0) {
      const deleteResult = await db
        .collection<LegislationType>("legislationTypes")
        .deleteMany({ _id: { $in: DEPRECATED_TYPE_IDS } });
      if (deleteResult.deletedCount > 0) {
        console.log(`Deleted ${deleteResult.deletedCount} deprecated legislation types.`);
      }
    }

    // Upsert legislation types (no drop)
    for (const lt of legislationTypes) {
      await db
        .collection<LegislationType>("legislationTypes")
        .updateOne({ _id: lt._id }, { $set: lt }, { upsert: true });
    }
    console.log(`Upserted ${legislationTypes.length} legislation types.`);

    if (RESET_COMMITTEES) {
      const result = await db.collection("committeeAssignments").deleteMany({});
      console.log(`Cleared ${result.deletedCount} committee assignments.`);
    } else {
      const count = await db.collection("committeeAssignments").countDocuments();
      console.log(
        `Committee assignments unchanged (${count} existing). Use --reset-committees to clear.`
      );
    }

    console.log(
      "\nDone. Legislation seed is non-destructive; other collections were not modified."
    );
  } finally {
    await closeDb();
  }
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
