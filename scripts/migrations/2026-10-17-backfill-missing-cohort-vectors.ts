/**
 * Safely backfill missing `regionDemographics` stocks without resetting any
 * existing region's evolved population cohort. Dry-run is the default; use
 * `--apply` to insert only absent cohort stocks.
 *
 * Usage:
 *   npx tsx scripts/migrations/2026-10-17-backfill-missing-cohort-vectors.ts
 *   npx tsx scripts/migrations/2026-10-17-backfill-missing-cohort-vectors.ts --apply
 *   npx tsx scripts/migrations/2026-10-17-backfill-missing-cohort-vectors.ts --live
 *   npx tsx scripts/migrations/2026-10-17-backfill-missing-cohort-vectors.ts --live --apply
 */

import { MongoClient } from "mongodb";
import * as dotenv from "dotenv";
import * as path from "path";
import { seedCohortVectors } from "@/lib/admin/seed/seedCohortVectors";
import { DEFAULT_SEED_PRESET } from "@/lib/constants/seedPreset";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const argv = process.argv.slice(2);
const apply = argv.includes("--apply");
const useLive = argv.includes("--live");
const sourceUri = useLive ? process.env.MONGODB_URI_LIVE : process.env.MONGODB_URI;
if (!sourceUri) {
  console.error(`MISSING env: ${useLive ? "MONGODB_URI_LIVE" : "MONGODB_URI"} not set`);
  process.exit(1);
}

async function main() {
  const uri = new URL(sourceUri!);
  if (useLive) uri.searchParams.set("directConnection", "true");
  const client = new MongoClient(uri.toString());
  await client.connect();
  console.log(apply ? "=== APPLY MODE: missing records only ===" : "=== DRY RUN: no writes ===");
  try {
    const db = client.db();
    const gameState = await db.collection("gameState").findOne<{ preset?: string }>({});
    const preset = gameState?.preset ?? DEFAULT_SEED_PRESET;
    console.log(`Preset: ${preset}`);

    const stats = await seedCohortVectors(db, preset, (message) => console.log(message), {
      apply,
      onlyMissing: true,
    });
    const drift =
      stats.totalTargetPop > 0
        ? ((stats.totalPeople - stats.totalTargetPop) / stats.totalTargetPop) * 100
        : 0;
    console.log(
      `\nMissing cohort stocks: ${stats.covered}; already present and preserved: ${stats.alreadySeeded}; ` +
        `skipped: ${stats.skipped.length}.` +
        `\nSynthesized population: ${Math.round(stats.totalPeople).toLocaleString("en-US")}; ` +
        `current target population: ${Math.round(stats.totalTargetPop).toLocaleString("en-US")}; ` +
        `rounding drift: ${drift.toFixed(6)}%.`
    );
    for (const skipped of stats.skipped) console.log(`  - ${skipped}`);
    console.log(apply ? "Applied missing-only backfill." : "Dry run only; no records changed.");
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
