/**
 * Backfill simulated intra-turn high/low spread on existing marketCapHistory records.
 *
 * Each turn was recorded with a single close price per exchange. Candlestick
 * charts need a high and low to draw wicks. This script adds a plausible
 * ±0.3–1.5% intra-turn spread to every record that is missing globalHigh/globalLow.
 *
 * Safe to re-run — only touches records that have no globalHigh field yet.
 *
 * Usage:
 *   npx tsx scripts/backfill-market-cap-spreads.ts [--dry-run]
 */

import * as fs from "fs";
import * as path from "path";
import { MongoClient, ObjectId } from "mongodb";

const isDryRun = process.argv.includes("--dry-run");

function readEnvUri(): string {
  const envPath = path.join(__dirname, "../.env.local");
  const content = fs.readFileSync(envPath, "utf8");
  const match = content.match(/^MONGODB_URI=(.+)$/m);
  if (!match) throw new Error("MONGODB_URI not found in .env.local");
  return match[1].trim();
}

function spreadAround(close: number): { high: number; low: number } {
  if (close <= 0) return { high: close, low: close };
  const pct = 0.003 + Math.random() * 0.012; // 0.3–1.5%
  const range = close * pct;
  const upFrac = 0.2 + Math.random() * 0.6;
  return {
    high: Math.round(close + range * upFrac),
    low: Math.max(1, Math.round(close - range * (1 - upFrac))),
  };
}

async function main() {
  const uri = readEnvUri();
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db("a-house-divided");
  const col = db.collection("marketCapHistory");

  // Find all records without the new spread fields
  const records = await col
    .find({ globalHigh: { $exists: false } })
    .project<{
      _id: ObjectId;
      globalMarketCap: number;
      nyseMarketCap: number;
      ftseMarketCap: number;
    }>({ _id: 1, globalMarketCap: 1, nyseMarketCap: 1, ftseMarketCap: 1 })
    .toArray();

  console.log(`Found ${records.length} records to backfill${isDryRun ? " (dry run)" : ""}`);

  if (!isDryRun && records.length > 0) {
    const ops = records.map((r) => {
      const g = spreadAround(r.globalMarketCap);
      const n = spreadAround(r.nyseMarketCap);
      const f = spreadAround(r.ftseMarketCap);
      return {
        updateOne: {
          filter: { _id: r._id },
          update: {
            $set: {
              globalHigh: g.high,
              globalLow: g.low,
              nyseHigh: n.high,
              nyseLow: n.low,
              ftseHigh: f.high,
              ftseLow: f.low,
            },
          },
        },
      };
    });

    const result = await col.bulkWrite(ops, { ordered: false });
    console.log(`Updated ${result.modifiedCount} records`);
  }

  await client.close();
  console.log("Done");
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
