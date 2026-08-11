/**
 * Migration: Add indexes for game health and code quality collections
 *
 * gameHealthSnapshots:
 * - TTL index on `timestamp` (30 days auto-expiry)
 * - Descending index on `turn` for latest-first queries
 * - Compound for warnings route ($or on warning/error counts)
 *
 * codeQualitySnapshots:
 * - Descending index on `timestamp` for latest-first queries
 * - Compound for environment-filtered queries
 *
 * Run: npx tsx scripts/migrations/add-health-quality-indexes.ts
 */

import { connectDb, closeDb } from "../../utils/db";

async function migrate() {
  console.log("Adding game health & code quality indexes...");
  const db = await connectDb();

  const results: string[] = [];

  async function ensure(
    collection: string,
    key: Record<string, 1 | -1>,
    name: string,
    options?: { expireAfterSeconds?: number }
  ) {
    try {
      await db.collection(collection).createIndex(key, { name, ...options });
      results.push(`✓ ${collection}.${name}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("already exists")) {
        results.push(`= ${collection}.${name} (already exists)`);
      } else {
        results.push(`✗ ${collection}.${name}: ${msg}`);
      }
    }
  }

  // gameHealthSnapshots — TTL: auto-delete after 30 days
  await ensure(
    "gameHealthSnapshots",
    { timestamp: 1 },
    "ghs_timestamp_ttl",
    { expireAfterSeconds: 30 * 24 * 60 * 60 } // 30 days
  );

  // gameHealthSnapshots — latest-first queries by turn
  await ensure("gameHealthSnapshots", { turn: -1 }, "ghs_turn_desc");

  // gameHealthSnapshots — warnings route: filter snapshots with warnings/errors/issues
  await ensure(
    "gameHealthSnapshots",
    { "turnProcessing.warningCount": 1, "turnProcessing.errorCount": 1, turn: -1 },
    "ghs_warnings_errors_turn"
  );

  // codeQualitySnapshots — latest-first queries
  await ensure("codeQualitySnapshots", { timestamp: -1 }, "cqs_timestamp_desc");

  // codeQualitySnapshots — environment-filtered latest-first
  await ensure("codeQualitySnapshots", { environment: 1, timestamp: -1 }, "cqs_env_timestamp");

  await closeDb();

  console.log("\nResults:");
  results.forEach((r) => console.log(" ", r));
  console.log("\nDone.");
}

migrate().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
