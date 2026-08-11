/**
 * Brazil Seed Orchestrator
 *
 * Seeds all BR game data in the correct order. Run against the target
 * database before flipping COUNTRY_CONFIGS.BR.status to "active".
 *
 * Usage: npx tsx scripts/seed-br.ts
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
 *   8. Government formation document
 */

import { connectDb, closeDb } from "./utils/db";

async function main() {
  console.log("=== Brazil Seed Orchestrator ===\n");
  const _db = await connectDb();

  // This script is a placeholder for the admin seed tool integration.
  // The actual seed data files exist at:
  //   src/lib/seeds/br/brRegions.ts
  //   src/lib/seeds/br/brParties.ts
  //   src/lib/seeds/br/brDemographicCategories.ts
  //   src/lib/seeds/br/brRegionDemographics.ts
  //   src/lib/seeds/br/brDemographicTurnout.ts
  //   src/lib/seeds/br/brStateMetrics.ts
  //   src/lib/seeds/br/brStateBaselines.ts
  //   src/lib/seeds/br/brGovernmentFormation.ts
  //
  // The admin seed tool at /api/admin/seed handles inserting these into the DB.
  // This script can be extended to call those seed functions directly
  // for CLI-based seeding outside the admin panel.

  console.log("BR seed data files are ready.");
  console.log("Use the Admin > Seed panel to seed BR data, or extend this script.");
  console.log("\nTo activate Brazil:");
  console.log("  1. Seed all BR data via admin panel");
  console.log("  2. Change COUNTRY_CONFIGS.BR.status from 'coming-soon' to 'active'");
  console.log("  3. Deploy");

  await closeDb();
}

main().catch(console.error);
