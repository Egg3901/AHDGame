/**
 * Japan Seed Orchestrator
 *
 * Seeds all JP game data in the correct order. Run against the target
 * database before flipping COUNTRY_CONFIGS.JP.status to "active".
 *
 * Usage: npx tsx scripts/seed-jp.ts
 *
 * Prerequisite: MONGODB_URI environment variable must be set.
 *
 * Step order (matches design spec):
 *   1. States (regions)
 *   2. Parties
 *   3. Demographic categories
 *   4. Region demographics
 *   5. Demographic turnout
 *   6. State party orgs
 *   7. State metrics
 *   8. State baselines
 *   9. Budgets (national via generateCountryOwnedSeedData; regional via generateStateBudgets)
 *  10. Seats
 *  11. Government formation document
 *  12. Legislation types (included in central legislationTypes array)
 *  13. Cabinet positions (via admin seed tool — constants only, no DB seed needed)
 */

import { connectDb, closeDb } from "../utils/db";

async function main() {
  console.log("=== Japan Seed Orchestrator ===\n");
  const _db = await connectDb();

  // This script is a placeholder for the admin seed tool integration.
  // The actual seed data files exist at:
  //   src/lib/countries/jp/data/jpRegions.ts
  //   src/lib/countries/jp/data/jpParties.ts
  //   src/lib/countries/jp/data/jpDemographicCategories.ts
  //   src/lib/countries/jp/data/jpRegionDemographics.ts
  //   src/lib/countries/jp/data/jpDemographicTurnout.ts
  //   src/lib/countries/jp/data/jpStateMetrics.ts
  //   src/lib/countries/jp/data/jpStateBaselines.ts
  //   src/lib/countries/jp/data/jpStatePartyOrgCalculations.ts
  //   src/lib/countries/jp/data/jpBudgets.ts
  //   src/lib/countries/jp/data/jpLegislationTypes.ts
  //   src/lib/countries/jp/data/jpGovernmentFormation.ts
  //   src/lib/countries/jp/data/jpCorporations.ts
  //
  // The admin seed tool at /api/admin/seed handles inserting these into the DB.
  // This script can be extended to call those seed functions directly
  // for CLI-based seeding outside the admin panel.

  console.log("JP seed data files are ready.");
  console.log("Use the Admin > Seed panel to seed JP data, or extend this script.");
  console.log("\nTo activate Japan:");
  console.log("  1. Seed all JP data via admin panel");
  console.log("  2. Change COUNTRY_CONFIGS.JP.status from 'coming-soon' to 'active'");
  console.log("  3. Deploy");

  await closeDb();
}

main().catch(console.error);
