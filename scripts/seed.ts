/**
 * CLI entry for US reference seeding. Core logic: `runSeed` in `src/lib/admin/seed/runCoreSeed.ts`.
 */
import { connectDb, closeDb } from "./utils/db";
import { runSeed } from "../src/lib/admin/seed/runCoreSeed";
import { DEFAULT_SEED_PRESET } from "@/lib/constants/seedPreset";

/**
 * Era preset for this one-off script. The seeder's `preset` parameter used to
 * default to "2019-default", so running this against a historical world
 * silently wrote modern data. Explicit and overridable:
 *   SEED_PRESET=1953-default npx tsx <this script>
 */
const PRESET = process.env.SEED_PRESET ?? DEFAULT_SEED_PRESET;

/** Re-export for legacy dynamic imports (e.g. tooling that still resolves `scripts/seed`). */
export { runSeed };

const RESET_FLAG = process.argv.includes("--reset");

async function main() {
  console.log("Starting database seed...\n");
  if (RESET_FLAG) console.log("RESET mode: collections will be dropped first\n");

  const db = await connectDb();
  try {
    const result = await runSeed({ db, reset: RESET_FLAG, preset: PRESET, log: console.log });
    console.log(result.message);
    if (!result.seeded && !RESET_FLAG) process.exit(0);
    console.log("Database seed completed successfully!");
  } catch (error) {
    console.error("Seed failed:", error);
    process.exit(1);
  } finally {
    await closeDb();
  }
}

if (require.main === module) {
  void main();
}
