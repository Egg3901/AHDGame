/**
 * One-time migration: reset gdpGrowth values corrupted by the old
 * computeAnnualizedGdpGrowth approach, which incorrectly annualized
 * single-turn revenue changes (producing 50–178% for most states).
 *
 * Reads each state's gdpGrowth baseline from stateBaselines and writes it
 * back to stateMetrics. Defaults to 2.0% (trend growth) for states with
 * no recorded baseline.
 *
 * Usage: npx tsx scripts/migrations/reset-gdp-growth-to-baseline.ts
 */

import { MongoClient } from "mongodb";
import * as fs from "fs";

const TREND_DEFAULT = 2.0;
const NATIONAL_SCOPE_IDS = new Set([
  "federal",
  "uk_national",
  "ca_national",
  "de_national",
  "jp_national",
]);

async function main() {
  const envFile = fs.readFileSync(".env.local", "utf-8");
  const uriMatch = envFile.match(/MONGODB_URI=(.+)/);
  if (!uriMatch) throw new Error("MONGODB_URI not found in .env.local");
  const uri = uriMatch[1].trim();

  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db("a-house-divided");

  // Build baseline map from stateBaselines collection
  const baselines = await db.collection("stateBaselines").find({}).toArray();
  const baselineMap = new Map<string, number>();

  for (const b of baselines) {
    const doc = b as Record<string, unknown> & {
      baselines?: { economic?: { gdpGrowth?: number } };
    };
    const gdpGrowthBaseline = doc.baselines?.economic?.gdpGrowth;
    if (typeof gdpGrowthBaseline === "number") {
      baselineMap.set(String(b._id), gdpGrowthBaseline);
    }
  }

  console.log(`Loaded ${baselineMap.size} baselines from stateBaselines.`);

  const allMetrics = await db.collection("stateMetrics").find({}).toArray();

  const ops = [];
  let resetCount = 0;
  let skippedCount = 0;

  for (const m of allMetrics) {
    const stateId = String(m._id);

    // Skip national-scope docs — they recompute from state averages next turn
    if (NATIONAL_SCOPE_IDS.has(stateId)) {
      skippedCount++;
      continue;
    }

    const currentValue = (
      m as Record<string, unknown> & {
        economic?: { gdpGrowth?: { value?: number } };
      }
    ).economic?.gdpGrowth?.value;

    const targetValue = baselineMap.get(stateId) ?? TREND_DEFAULT;

    ops.push({
      updateOne: {
        filter: { _id: m._id },
        update: {
          $set: {
            "economic.gdpGrowth.value": targetValue,
            lastUpdated: new Date(),
          },
        },
      },
    });
    resetCount++;
    console.log(`  ${stateId}: ${currentValue?.toFixed(2) ?? "?"}% → ${targetValue}%`);
  }

  if (ops.length === 0) {
    console.log("No states found — nothing to reset.");
    await client.close();
    return;
  }

  await db.collection("stateMetrics").bulkWrite(ops);
  console.log(
    `\nReset ${resetCount} states to baseline GDP growth values. Skipped ${skippedCount} national-scope docs (will recompute next turn).`
  );

  await client.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
