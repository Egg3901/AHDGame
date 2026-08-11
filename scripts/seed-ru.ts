/**
 * USSR re-seed — applies the bare region codes (SU_NOR → NOR, …) to the dev DB.
 *
 * Deletes the old SU_* region docs and re-seeds states + demographics + metrics +
 * baselines with the new codes. seedRU*'s reset deletes states/demographics by
 * countryId (catches the old ids) but metrics/baselines reset by the NEW codes, so
 * the old SU_* metric/baseline orphans are cleared explicitly here first.
 *
 * Idempotent. Does NOT touch parties (run the full seed for those). 1979 preset.
 * Usage: npx tsx scripts/seed-ru.ts
 */
import { connectDb, closeDb } from "./utils/db";
import {
  seedRURegions,
  seedRUDemographics,
  seedRUStateMetrics,
  seedRUBaselines,
} from "@/lib/admin/seed/seedRU";
import { DEFAULT_SEED_PRESET } from "@/lib/constants/seedPreset";

/**
 * Era preset for this one-off script. Previously each seeder's `preset`
 * parameter defaulted to "2019-default", so running this against a historical
 * world silently wrote modern data. Now explicit and overridable:
 *   SEED_PRESET=1953-default npx tsx <this script>
 */
const PRESET = process.env.SEED_PRESET ?? DEFAULT_SEED_PRESET;

const log = (msg: string) => console.log("   " + msg);

async function main() {
  console.log("=== USSR re-seed (bare region codes) ===\n");
  const db = await connectDb();

  console.log("0. Clearing old SU_* metric/baseline orphans...");
  const m = await db.collection("stateMetrics").deleteMany({ _id: { $regex: "^SU_" } as never });
  const b = await db.collection("stateBaselines").deleteMany({ _id: { $regex: "^SU_" } as never });
  console.log(`   ✓ removed ${m.deletedCount} metric + ${b.deletedCount} baseline orphans`);

  console.log("1. Regions (states)...");
  await seedRURegions(db, true, log, "1979-default");
  console.log("2. Demographics...");
  await seedRUDemographics(db, true, log, "1979-default");
  console.log("3. State metrics...");
  await seedRUStateMetrics(db, true, log, PRESET);
  console.log("4. Baselines...");
  await seedRUBaselines(db, true, log, PRESET);

  const states = await db
    .collection("states")
    .find({ countryId: "RU" }, { projection: { _id: 1 } })
    .toArray();
  console.log(
    `\n✓ RU states now: ${states
      .map((s) => s._id)
      .sort()
      .join(", ")}`
  );

  await closeDb();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
