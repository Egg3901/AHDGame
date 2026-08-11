/**
 * Seed the `regionDemographics` collection (P1b-0, design §S4): one single-year
 * age×sex cohort vector per region, synthesized from the region's coarse census
 * age-shares + its `population.medianAge` / `population.birthRate` metrics +
 * `state.population`, plus the turn-0 derived population metrics (sexRatio /
 * dependencyRatio / realizedMigrationRate) stamped onto stateMetrics.
 *
 * The synthesis + write is the SHARED `seedCohortVectors` core (also called by
 * `bootstrapGameWorld` on every reset), so the seeded vectors are byte-identical to
 * what the unit-tested SSOT produces and live-world backfills match fresh resets.
 * This migration just wraps it with CLI dry-run / live-targeting / preset override
 * for backfilling EXISTING live worlds (a fresh reset already builds them).
 *
 * Guarded:
 *   - DRY RUN by default. `--apply` to write.
 *   - `--live` targets MONGODB_URI_LIVE (else MONGODB_URI).
 *   - `--preset=<id>` overrides the world preset (else read from gameState.preset,
 *     else "2019-default").
 *   - Idempotent against a FRESH world (synthesis is deterministic). WARNING: once
 *     P1b-1 cohort flows have evolved a region's vector, re-running clobbers that
 *     evolved stock back to seed state — only run on a fresh / reset world.
 *
 * Usage:
 *   npx tsx scripts/migrations/2026-06-10-seed-cohort-vectors.ts                 # dry-run (local)
 *   npx tsx scripts/migrations/2026-06-10-seed-cohort-vectors.ts --apply         # write (local)
 *   npx tsx scripts/migrations/2026-06-10-seed-cohort-vectors.ts --live --apply  # write (live)
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
const presetArg = argv.find((a) => a.startsWith("--preset="))?.split("=")[1];

const uri = useLive ? process.env.MONGODB_URI_LIVE : process.env.MONGODB_URI;
if (!uri) {
  console.error(`MISSING env: ${useLive ? "MONGODB_URI_LIVE" : "MONGODB_URI"} not set`);
  process.exit(1);
}

const fmt = (n: number) => Math.round(n).toLocaleString("en-US");

async function main() {
  const client = new MongoClient(uri!);
  await client.connect();
  console.log(apply ? "=== APPLY MODE ===" : "=== DRY RUN ===");
  try {
    const db = client.db();

    const gameState = await db.collection("gameState").findOne<{ preset?: string }>({});
    const preset = presetArg ?? gameState?.preset ?? DEFAULT_SEED_PRESET;
    console.log(`Preset: ${preset}${presetArg ? " (CLI override)" : ""}`);

    const stats = await seedCohortVectors(db, preset, (m) => console.log(m), { apply });

    const drift =
      stats.totalTargetPop > 0
        ? ((stats.totalPeople - stats.totalTargetPop) / stats.totalTargetPop) * 100
        : 0;
    console.log(
      `\nCoverage: ${stats.covered} regions (${stats.skipped.length} skipped). ` +
        `Σ synthesized people: ${fmt(stats.totalPeople)} vs Σ target population: ` +
        `${fmt(stats.totalTargetPop)} (rounding drift ${drift.toFixed(4)}%)`
    );
    if (stats.skipped.length) {
      console.log(`Skipped regions:`);
      for (const m of stats.skipped) console.log(`  - ${m}`);
    }
    console.log(apply ? `\nApplied.` : `\nDry run only — re-run with --apply to write.`);
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
