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
 * Backfill the defense military order-of-battle for EXISTING databases.
 *
 * `runSeed` (the boot seed) early-returns when a database is already seeded, so
 * `seedMilitaryUnits` only runs for fresh DBs. Existing games (dev + production)
 * need this one-off backfill. Idempotent: `seedMilitaryUnits` only seeds
 * countries that currently have zero units, so re-running is safe.
 *
 * Run: `npx tsx scripts/backfill-military-units.ts`
 */
import { connectDb, closeDb } from "./utils/db";
import { seedMilitaryUnits } from "@/lib/admin/seed/seedMilitaryUnits";
import { getMilitaryUnitsCollection } from "@/lib/db/collections/militaryUnits";
import type { GameState } from "@/lib/db/types/gameState";
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
    // Read the world's OWN preset rather than letting seedMilitaryUnits default
    // to "2019-default". The preset picks both the era gate on branches and the
    // order of battle, so running this against a 1953 world under the default
    // would seed 2019 compositions — and it now covers 24 countries, not 6.
    const gs = await db
      .collection<GameState>("gameState")
      .findOne({ _id: "current" }, { projection: { preset: 1 } });
    // Merge note: development passed the `SEED_PRESET` env var straight through
    // (`PRESET`) once #3908 made the parameter required. That fixes the "required
    // argument" half but still lets an operator who forgets the env var seed 2019
    // compositions into a 1953 world — the exact hazard the rule exists for. The
    // world's OWN preset wins; `PRESET` stays as the fallback for a world whose
    // gameState has none, so the env var remains useful without being able to
    // override reality.
    const preset = gs?.preset ?? PRESET;
    if (!gs?.preset) {
      console.warn(
        `[backfill] gameState has no preset; falling back to "${preset}" ` +
          `(from SEED_PRESET, else the 2019 default).`
      );
    }
    console.log(`[backfill] seeding against preset "${preset}"`);

    const before = await getMilitaryUnitsCollection(db).countDocuments();
    await seedMilitaryUnits(db, preset);
    const after = await getMilitaryUnitsCollection(db).countDocuments();
    console.log(`militaryUnits: ${before} → ${after} (+${after - before})`);

    // Report whatever actually has units instead of a hardcoded six — this now
    // covers 18 more countries and a fixed list would under-report every one.
    const counts = await getMilitaryUnitsCollection(db)
      .aggregate<{ _id: string; n: number }>([
        { $group: { _id: "$countryId", n: { $sum: 1 } } },
        { $sort: { _id: 1 } },
      ])
      .toArray();
    for (const { _id, n } of counts) console.log(`  ${_id}: ${n}`);
  } finally {
    await closeDb();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
