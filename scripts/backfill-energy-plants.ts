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
 * Backfill energy plants for EXISTING databases. `runSeed` early-returns when a DB
 * is already seeded, so `seedEnergyPlants` only runs for fresh DBs. Existing games
 * (dev + production) need this one-off backfill. Idempotent: seeds only
 * (country, energy seat) pairs with zero plants, so re-running is safe.
 *
 * Run: `npx tsx scripts/backfill-energy-plants.ts`
 */
import { connectDb, closeDb } from "./utils/db";
import { seedEnergyPlants } from "@/lib/admin/seed/seedEnergyPlants";
import { getEnergyPlantsCollection } from "@/lib/db/collections/energyPlants";
import { DEFAULT_SEED_PRESET } from "@/lib/constants/seedPreset";

/**
 * Era preset for this one-off script. The seeder's `preset` parameter used to
 * default to "2019-default", so running this against a historical world
 * silently wrote modern data. Explicit and overridable:
 *   SEED_PRESET=1953-default npx tsx <this script>
 */
const PRESET = process.env.SEED_PRESET ?? DEFAULT_SEED_PRESET;

async function main() {
  const db = await connectDb();
  try {
    const before = await getEnergyPlantsCollection(db).countDocuments();
    await seedEnergyPlants(db, PRESET);
    const after = await getEnergyPlantsCollection(db).countDocuments();
    console.log(`energyPlants: ${before} → ${after} (+${after - before})`);
  } finally {
    await closeDb();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
