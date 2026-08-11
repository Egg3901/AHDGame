/**
 * Migration: Reset corrupted German (DE) state metrics to their seed values.
 *
 * Bug #0571: DE state baselines were missing for ~989 turns, causing
 * processStatePolicyEffects to use a hardcoded fallback baseline of 50.
 * All metrics drifted toward 50, producing nonsensical values:
 *   - gdpGrowth: ~28-29% (should be ~0.5-2.0%)
 *   - medianIncome: ~24k EUR (should be ~38k-58k)
 *   - smallBusinessFormation: ~49.6 (should be ~4.5-8.0)
 *   - laborParticipation: ~50 (should be ~78)
 *
 * After seeding the correct baselines (fix-missing-baselines.ts), this
 * script restores the metric values themselves so recovery is instant
 * rather than taking ~140 turns of gradual decay.
 *
 * Usage: npx tsx scripts/migrations/reset-de-metrics-to-seed.ts [--dry-run]
 */

import { MongoClient } from "mongodb";
import * as fs from "fs";

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");

  const envFile = fs.readFileSync(".env.local", "utf-8");
  const uriMatch = envFile.match(/MONGODB_URI=(.+)/);
  if (!uriMatch) throw new Error("MONGODB_URI not found in .env.local");
  const uri = uriMatch[1].trim();

  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db("a-house-divided");

  // Import seed metrics
  const { deStateMetrics } = await import("@/lib/seeds/de/deStateMetrics");

  let resetCount = 0;
  const bulkOps = [];

  for (const seedDoc of deStateMetrics) {
    const { _id, lastUpdated: _lastUpdated, ...categories } = seedDoc;

    // Build $set operations for each category/metric
    const setOps: Record<string, unknown> = {};
    for (const [category, metrics] of Object.entries(categories)) {
      if (!metrics || typeof metrics !== "object") continue;
      for (const [metricId, metricValue] of Object.entries(metrics as Record<string, unknown>)) {
        if (metricValue && typeof (metricValue as Record<string, unknown>).value === "number") {
          setOps[`${category}.${metricId}.value`] = (metricValue as { value: number }).value;
          // Preserve any existing trend field if present, otherwise leave it
        }
      }
    }

    if (Object.keys(setOps).length === 0) continue;

    if (dryRun) {
      console.log(`[DRY RUN] Would reset ${_id}:`, Object.keys(setOps).length, "metrics");
    } else {
      bulkOps.push({
        updateOne: {
          filter: { _id },
          update: {
            $set: {
              ...setOps,
              lastUpdated: new Date(),
            },
          },
        },
      });
    }
  }

  if (!dryRun && bulkOps.length > 0) {
    await db.collection<{ _id: string }>("stateMetrics").bulkWrite(bulkOps);
    resetCount = bulkOps.length;
  }

  console.log(
    `${dryRun ? "[DRY RUN] Would reset" : "Reset"} ${resetCount} DE state metric documents`
  );

  // Also reset DE_national so computeNationalMetrics starts from a clean slate
  const deNationalIds = ["DE_national", "de_national"];
  for (const id of deNationalIds) {
    const exists = await db.collection<{ _id: string }>("stateMetrics").findOne({ _id: id });
    if (exists) {
      if (dryRun) {
        console.log(`[DRY RUN] Would delete national metric doc ${id}`);
      } else {
        await db.collection<{ _id: string }>("stateMetrics").deleteOne({ _id: id });
        console.log(
          `Deleted national metric doc ${id} (will be rebuilt by computeNationalMetrics)`
        );
      }
    }
  }

  await client.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
