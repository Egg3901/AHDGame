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
 * Backfill infrastructure projects for EXISTING databases. `runSeed` early-returns
 * when a DB is already seeded, so `seedInfraProjects` only runs for fresh DBs.
 * Existing games (dev + production) need this one-off backfill. Idempotent: seeds
 * only (country, transportation seat) pairs with zero projects.
 *
 * Run: `npx tsx scripts/backfill-infra-projects.ts`
 */
import { connectDb, closeDb } from "./utils/db";
import { seedInfraProjects } from "@/lib/admin/seed/seedInfraProjects";
import { getInfraProjectsCollection } from "@/lib/db/collections/infraProjects";
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
    const before = await getInfraProjectsCollection(db).countDocuments();
    await seedInfraProjects(db, PRESET);
    const after = await getInfraProjectsCollection(db).countDocuments();
    console.log(`infraProjects: ${before} → ${after} (+${after - before})`);
  } finally {
    await closeDb();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
