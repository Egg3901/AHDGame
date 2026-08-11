/**
 * Seed demographic categories and state demographics.
 * Non-destructive: only upserts demographicCategories and stateDemographics.
 * Does not touch states, parties, users, characters, or other collections.
 *
 * Flow: Base census data (race, education, wealth, age, ideology) per state
 * is defined in stateDemographics.ts and DERIVED into 12 voter archetype groups
 * at seed time. The DB stores the final 12 groups per state, not the raw base layer.
 *
 * Run this if political lean shows as "Centrist/Moderate" for all states —
 * the demographic calculation needs these collections to compute state leans.
 *
 * Usage:
 *   npx tsx scripts/seed-demographics.ts
 *   npm run seed:demographics
 */

import { connectDb, closeDb } from "../utils/db";
import { demographicCategories } from "../../src/lib/seeds/demographicCategories";
import { stateDemographics } from "../../src/lib/seeds/stateDemographics";
import { calculateStateLean } from "../../src/lib/utils/demographics";
import type { DemographicCategory, State, StateDemographics } from "../../src/lib/db/types";

async function main() {
  console.log("Seed: Demographics (categories + state demographics)\n");
  console.log(
    "  Base census data (race, education, wealth, age, ideology) → 12 voter archetypes per state"
  );
  console.log(
    "  Weights = pop × turnout × categoryWeight; turnout derived from age/education per group\n"
  );

  const db = await connectDb();

  try {
    // Upsert demographic categories (12 voter archetypes)
    for (const category of demographicCategories) {
      await db
        .collection<DemographicCategory>("demographicCategories")
        .updateOne({ _id: category._id }, { $set: category }, { upsert: true });
    }
    const groupsCount = demographicCategories.reduce((s, c) => s + (c.groups?.length ?? 0), 0);
    console.log(
      `Upserted ${demographicCategories.length} category (${groupsCount} voter archetypes).`
    );

    // Upsert state demographics and demographicDefaults (game reset restores from defaults)
    for (const sd of stateDemographics) {
      await db
        .collection<StateDemographics>("stateDemographics")
        .updateOne({ _id: sd._id }, { $set: sd }, { upsert: true });
      await db
        .collection<StateDemographics>("demographicDefaults")
        .updateOne({ _id: sd._id }, { $set: sd }, { upsert: true });
      const calculatedLean = calculateStateLean(sd, demographicCategories);
      await db.collection<State>("states").updateOne(
        { _id: sd._id },
        {
          $set: {
            cachedEconomicLean: calculatedLean.economicLean,
            cachedSocialLean: calculatedLean.socialLean,
            demographicsLastUpdated: new Date(),
          },
        }
      );
    }
    console.log(
      `Upserted ${stateDemographics.length} state demographics (derived from base census per state) and demographicDefaults.`
    );
    console.log("Refreshed cached leans on states (calibrated to 2020 election results).");

    console.log("\nDone. Political lean should now align with 2020 election results.");
  } finally {
    await closeDb();
  }
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
