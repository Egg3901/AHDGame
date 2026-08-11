/**
 * ⚠️ ROOT CAUSE FIXED — this is now a repair tool for worlds seeded BEFORE that
 * fix, not a standing gap. Do not treat its existence as evidence that the
 * seeder is still misplaced.
 *
 * The stated reason below ("runSeed early-returns when a DB is already seeded")
 * was only half of it, and the smaller half. The real cause was ordering:
 * `runSeed` seeds ONLY the US states bundle and then called this seeder, which
 * reads `states` for its roster — so even a completely fresh world got US data
 * and nothing else. Measured on a 1953 bootstrap with 226 states across 24
 * countries: militaryUnits 13 docs / 1 country, energyPlants 7 / 1,
 * infraProjects 5 / 1, cabinetEstates 65 / 6.
 *
 * These four seeders now run from `runRegionDerivedStage`, once, after every
 * country has regions. A fresh world or a reset no longer needs any of this.
 *
 * Backfill cabinet estates for EXISTING databases. `runSeed` early-returns when a
 * DB is already seeded, so `seedCabinetEstates` only runs for fresh DBs. Existing
 * games (dev + production) need this one-off backfill. Idempotent:
 * `seedCabinetEstates` only seeds (country, seat) pairs with zero estates, so
 * re-running is safe.
 *
 * Run: `npx tsx scripts/backfill-cabinet-estates.ts`
 */
import { connectDb, closeDb } from "./utils/db";
import { seedCabinetEstates } from "@/lib/admin/seed/seedCabinetEstates";
import { getCabinetEstatesCollection } from "@/lib/db/collections/cabinetEstates";

async function main() {
  const db = await connectDb();
  try {
    const before = await getCabinetEstatesCollection(db).countDocuments();
    await seedCabinetEstates(db);
    const after = await getCabinetEstatesCollection(db).countDocuments();
    console.log(`cabinetEstates: ${before} → ${after} (+${after - before})`);
  } finally {
    await closeDb();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
