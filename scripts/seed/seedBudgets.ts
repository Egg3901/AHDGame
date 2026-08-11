import { connectDb, closeDb } from "../utils/db";
import {
  initialNationalBudgets,
  generateCountryOwnedSeedData,
  generateStateBudgets,
} from "../seeds/budgets";
import type { Corporation, CorporateSector, Counter } from "../../src/lib/db/types";
import type { FederalBudget, StateBudget } from "../../src/lib/db/types/budget";
import { DEFAULT_SEED_PRESET } from "@/lib/constants/seedPreset";

/**
 * Era preset for this one-off script. Previously each seeder's `preset`
 * parameter defaulted to "2019-default", so running this against a historical
 * world silently wrote modern data. Now explicit and overridable:
 *   SEED_PRESET=1953-default npx tsx <this script>
 */
const PRESET = process.env.SEED_PRESET ?? DEFAULT_SEED_PRESET;

async function seedBudgets() {
  const db = await connectDb();

  try {
    // Seed national budgets
    for (const nationalBudget of initialNationalBudgets) {
      await db
        .collection<FederalBudget>("federalBudget")
        .updateOne(
          { _id: nationalBudget._id },
          { $set: { ...nationalBudget, updatedAt: new Date() } },
          { upsert: true }
        );
    }
    console.log(`${initialNationalBudgets.length} national budgets seeded`);

    // Get states for state budget seeding
    const states = await db.collection("states").find({}).toArray();
    if (states.length === 0) {
      console.log("No states found - skipping state budgets. Run state seeding first.");
    } else {
      const stateData = states.map((s) => ({
        id: String(s._id),
        population: s.population || 1000000,
        gdp: s.gdp || (s.population || 1000000) * 50000 * 2.5,
        countryId: s.countryId,
      }));

      const stateBudgets = generateStateBudgets(stateData);

      for (const budget of stateBudgets) {
        await db
          .collection<StateBudget>("stateBudgets")
          .updateOne({ _id: budget._id }, { $set: budget }, { upsert: true });
      }
      console.log(`${stateBudgets.length} state budgets seeded`);

      const countryOwnedSeedData = generateCountryOwnedSeedData(stateData, PRESET);
      for (const entry of countryOwnedSeedData) {
        await db
          .collection<Corporation>("corporations")
          .updateOne({ _id: entry.corporation._id }, { $set: entry.corporation }, { upsert: true });

        for (const sector of entry.sectors) {
          await db.collection<CorporateSector>("corporateSectors").updateOne(
            {
              corporationId: entry.corporation._id,
              stateId: sector.stateId,
              sectorType: sector.sectorType,
            },
            { $set: sector },
            { upsert: true }
          );
        }
      }
      if (countryOwnedSeedData.length > 0) {
        console.log(`${countryOwnedSeedData.length} country-owned public corporations seeded`);
        // Ensure player-created corporations get sequential IDs above reserved public corp range
        await db
          .collection<Counter>("counters")
          .updateOne({ _id: "corporation" }, { $max: { seq: 900_002 } }, { upsert: true });
      }
    }

    // Create indexes
    await db
      .collection("enactedLaws")
      .createIndex({ scope: 1, stateId: 1, repealedAt: 1 })
      .catch(() => {});
    await db
      .collection("stateBudgets")
      .createIndex({ stateId: 1 })
      .catch(() => {});
    console.log("Indexes created");

    console.log("Budget seeding complete!");
  } finally {
    await closeDb();
  }
}

seedBudgets().catch((err) => {
  console.error("Seeding failed:", err);
  process.exit(1);
});
