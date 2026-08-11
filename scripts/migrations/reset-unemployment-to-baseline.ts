/**
 * One-time migration: reset unemploymentRate values that were corrupted by
 * the labor market derivation (which set all states to 25%). Reads each
 * state's recorded baseline from stateBaselines and writes it back to
 * stateMetrics. Defaults to NAIRU (5.0%) for states with no baseline.
 *
 * Usage: npx tsx scripts/migrations/reset-unemployment-to-baseline.ts
 */

import { MongoClient } from "mongodb";
import * as fs from "fs";

const NAIRU_DEFAULT = 5.0;

async function main() {
  const envFile = fs.readFileSync(".env.local", "utf-8");
  const uriMatch = envFile.match(/MONGODB_URI=(.+)/);
  if (!uriMatch) throw new Error("MONGODB_URI not found in .env.local");
  const uri = uriMatch[1].trim();

  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db("a-house-divided");

  // Fetch all stateBaselines to get the intended unemployment baselines
  const baselines = await db.collection("stateBaselines").find({}).toArray();
  const baselineMap = new Map<string, number>();

  for (const b of baselines) {
    const unemploymentBaseline = (
      b as Record<string, unknown> & { economic?: { unemploymentRate?: { baseline?: number } } }
    ).economic?.unemploymentRate?.baseline;
    if (typeof unemploymentBaseline === "number") {
      baselineMap.set(String(b._id), unemploymentBaseline);
    }
  }

  // Fetch all stateMetrics to find which ones have unemployment stuck at 25
  const allMetrics = await db.collection("stateMetrics").find({}).toArray();

  const ops = [];
  let resetCount = 0;

  for (const m of allMetrics) {
    const stateId = String(m._id);
    // Skip national-scope docs — they'll recompute next turn from state averages
    if (["federal", "uk_national", "ca_national", "de_national", "jp_national"].includes(stateId)) {
      continue;
    }

    const currentValue = (
      m as Record<string, unknown> & {
        economic?: { unemploymentRate?: { value?: number } };
      }
    ).economic?.unemploymentRate?.value;

    // Only reset if the value looks corrupted (at the max cap)
    if (currentValue !== 25) continue;

    const targetValue = baselineMap.get(stateId) ?? NAIRU_DEFAULT;

    ops.push({
      updateOne: {
        filter: { _id: m._id },
        update: {
          $set: {
            "economic.unemploymentRate.value": targetValue,
            lastUpdated: new Date(),
          },
        },
      },
    });
    resetCount++;
    console.log(`  ${stateId}: 25% → ${targetValue}%`);
  }

  if (ops.length === 0) {
    console.log("No states have unemployment stuck at 25% — nothing to reset.");
    await client.close();
    return;
  }

  await db.collection("stateMetrics").bulkWrite(ops);
  console.log(`\nReset ${resetCount} states to their baseline unemployment values.`);

  await client.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
