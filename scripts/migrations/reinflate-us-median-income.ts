/**
 * Migration (Phase 2 of median-income calibration): re-inflate the compressed
 * US median-income metric to its realistic 1991-seed scale.
 *
 * A past economy rescale compressed US state median income ~11x (live ~$2.6k
 * vs the 1991 code-seed ~$29k); no other country was affected (each is already
 * at its correct 1991 scale). This rescales every US state's
 * `economic.medianIncome` by a single uniform factor (seed national avg ÷ live
 * national avg) so the scale is restored while the per-state distribution is
 * preserved. BOTH `.value` and `.simBaseline` are scaled together so the
 * medianIncome registry node continues from the new baseline and wageGrowth
 * (its per-turn delta) does not spike.
 *
 * US-only, medianIncome-only. Dry-run first; targets MONGODB_URI_LIVE.
 *
 * Usage:
 *   npx tsx scripts/migrations/reinflate-us-median-income.ts --dry-run
 *   npx tsx scripts/migrations/reinflate-us-median-income.ts --apply
 */

import { MongoClient } from "mongodb";
import * as fs from "fs";

interface MetricValue {
  value: number;
  simBaseline?: number;
  trend?: number | null;
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const dryRun = !apply; // safe default: never write unless --apply is explicit

  let uri = process.env.MONGODB_URI_LIVE;
  if (!uri && fs.existsSync(".env.local")) {
    const uriMatch = fs.readFileSync(".env.local", "utf-8").match(/MONGODB_URI_LIVE=(.+)/);
    uri = uriMatch?.[1].trim();
  }
  if (!uri) throw new Error("MONGODB_URI_LIVE not set (env or .env.local)");

  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db("a-house-divided");

  // 1991-preset US code-seed (the realistic target scale).
  const { stateMetrics1991 } = await import("@/lib/seeds/reference/stateMetrics1991");
  const seedById = new Map<string, number>();
  for (const doc of stateMetrics1991) {
    const v = doc.economic?.medianIncome?.value;
    if (typeof v === "number") seedById.set(doc._id, v);
  }
  const seedVals = [...seedById.values()];
  const seedAvg = seedVals.reduce((s, v) => s + v, 0) / seedVals.length;

  // Live US state median-income docs (exclude any national-scope rollup doc;
  // the national display is recomputed from states).
  const liveDocs = await db
    .collection<{ _id: string; countryId?: string; economic?: { medianIncome?: MetricValue } }>(
      "stateMetrics"
    )
    .find({ countryId: "US", "economic.medianIncome.value": { $exists: true } })
    .project<{ _id: string; economic: { medianIncome: MetricValue } }>({
      _id: 1,
      "economic.medianIncome": 1,
    })
    .toArray();
  // Only real states (those present in the seed); skip national/federal rollups.
  const stateDocs = liveDocs.filter((d) => seedById.has(d._id));

  const liveVals = stateDocs.map((d) => d.economic.medianIncome.value);
  const liveAvg = liveVals.reduce((s, v) => s + v, 0) / liveVals.length;

  const factor = seedAvg / liveAvg;

  console.log(`US median income re-inflation`);
  console.log(`  seed (1991) national avg: ${Math.round(seedAvg).toLocaleString()}`);
  console.log(`  live national avg:        ${Math.round(liveAvg).toLocaleString()}`);
  console.log(`  uniform factor:           ×${factor.toFixed(3)}`);
  console.log(`  states to update:         ${stateDocs.length}`);
  console.log("");

  const bulkOps = [];
  let newSum = 0;
  for (const d of stateDocs) {
    const mi = d.economic.medianIncome;
    const oldValue = mi.value;
    const oldBaseline = typeof mi.simBaseline === "number" ? mi.simBaseline : mi.value;
    const newValue = Math.round(oldValue * factor);
    const newBaseline = Math.round(oldBaseline * factor);
    newSum += newValue;

    if (dryRun) {
      console.log(
        `[DRY RUN] ${d._id}: ${oldValue.toLocaleString()} → ${newValue.toLocaleString()} (baseline ${oldBaseline.toLocaleString()} → ${newBaseline.toLocaleString()})`
      );
    } else {
      bulkOps.push({
        updateOne: {
          filter: { _id: d._id },
          update: {
            $set: {
              "economic.medianIncome.value": newValue,
              "economic.medianIncome.simBaseline": newBaseline,
              lastUpdated: new Date(),
            },
          },
        },
      });
    }
  }

  console.log("");
  console.log(
    `  national avg after: ${Math.round(newSum / stateDocs.length).toLocaleString()} (target ~${Math.round(seedAvg).toLocaleString()})`
  );

  if (!dryRun && bulkOps.length > 0) {
    await db.collection<{ _id: string }>("stateMetrics").bulkWrite(bulkOps);
    console.log(`\nAPPLIED: updated ${bulkOps.length} US state median-income docs.`);
  } else {
    console.log(`\n[DRY RUN] No writes. Re-run with --apply to commit.`);
  }

  await client.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
