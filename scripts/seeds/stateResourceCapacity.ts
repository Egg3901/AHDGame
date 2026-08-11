/**
 * CLI wrapper — seeds the `stateResourceCapacity` collection.
 * Logic lives in `src/lib/admin/seed/seedStateResourceCapacity.ts`; data in
 * `src/lib/seeds/reference/stateResourceCapacity.ts`.
 *
 * Requires the `states` collection to already be seeded.
 */

import { connectDb, closeDb } from "../utils/db";
import { seedStateResourceCapacity } from "../../src/lib/admin/seed/seedStateResourceCapacity";
import { DEFAULT_SEED_PRESET } from "@/lib/constants/seedPreset";

/**
 * Era preset for this one-off script. Previously each seeder's `preset`
 * parameter defaulted to "2019-default", so running this against a historical
 * world silently wrote modern data. Now explicit and overridable:
 *   SEED_PRESET=1953-default npx tsx <this script>
 */
const PRESET = process.env.SEED_PRESET ?? DEFAULT_SEED_PRESET;

async function main() {
  const db = await connectDb();
  await seedStateResourceCapacity(db, false, console.log, PRESET);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(closeDb);
