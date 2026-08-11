/**
 * Ireland Seed Orchestrator
 *
 * Seeds all IE game data in the correct order. Run against the target
 * database before flipping COUNTRY_CONFIGS.IE.status to "active".
 *
 * Usage: npx tsx scripts/seed-ie.ts
 *
 * Prerequisite: MONGODB_URI environment variable must be set.
 *
 * Step order (matches design spec):
 *   1. States (regions)
 *   2. Parties
 *   3. Demographic categories
 *   4. Region demographics
 *   5. Demographic turnout
 *   6. State metrics
 *   7. State baselines
 *   8. Budgets (national via generateCountryOwnedSeedData; regional via generateStateBudgets)
 *   9. Government formation document
 *  10. Legislation types (included in central legislationTypes array)
 *  11. Cabinet positions (via admin seed tool — constants only, no DB seed needed)
 */

import { connectDb, closeDb } from "../utils/db";

async function main() {
  console.log("=== Ireland Seed Orchestrator ===\n");
  const _db = await connectDb();

  // This script is a placeholder for the admin seed tool integration.
  // The actual seed data files exist at:
  //   src/lib/seeds/ie/ieRegions.ts
  //   src/lib/seeds/ie/ieParties.ts
  //   src/lib/seeds/ie/ieDemographicCategories.ts
  //   src/lib/seeds/ie/ieRegionDemographics.ts
  //   src/lib/seeds/ie/ieDemographicTurnout.ts
  //   src/lib/seeds/ie/ieStateMetrics.ts
  //   src/lib/seeds/ie/ieStateBaselines.ts
  //   src/lib/seeds/ie/ieGovernmentFormation.ts
  //   src/lib/seeds/ie/ieBudgets.ts
  //   src/lib/seeds/ie/ieCorporations.ts
  //
  // The admin seed tool at /api/admin/seed handles inserting these into the DB.
  // This script can be extended to call those seed functions directly
  // for CLI-based seeding outside the admin panel.

  console.log("IE seed data files are ready.");
  console.log("Use the Admin > Seed panel to seed IE data, or extend this script.");
  console.log("\nTo activate Ireland:");
  console.log("  1. Seed all IE data via admin panel");
  console.log("  2. Change COUNTRY_CONFIGS.IE.status from 'coming-soon' to 'active'");
  console.log("  3. Deploy");

  await closeDb();
}

main().catch(console.error);
