/**
 * Migration: add a unique index on `commodityPrices.commodity`.
 *
 * MOTIVATION:
 *   `commodityPriceTurn` does `updateOne({ commodity }, ..., upsert: true)`
 *   — the contract is "one row per commodity". Without a unique index, a bug
 *   or mis-targeted batch write (see `heal-nan-cascade-spread.ts`, which
 *   filtered on `commodityType` instead of `commodity` and overwrote 20 rows'
 *   `commodity` field to `"copper"`) silently produces duplicates. The
 *   `inflationRecalc` loop then averages per-row `nationalPrice/basePrice−1`
 *   across every doc, so duplicates balloon commodity pressure and pin
 *   inflation at the 15% cap.
 *
 *   A unique index makes this impossible at the DB layer: the buggy
 *   migration would have thrown `E11000 duplicate key` on its first
 *   write, forcing a real fix instead of silent corruption.
 *
 * PREREQ:
 *   Collection must be free of duplicates or index creation fails. The
 *   `heal-commodity-prices-copper-duplicates` migration runs first and
 *   leaves exactly one row per commodity — this script verifies that
 *   invariant before attempting to create the index.
 *
 * USAGE:
 *   # Dry-run (default — reports only)
 *   npx tsx scripts/migrations/add-commodity-prices-unique-index.ts
 *
 *   # Apply
 *   npx tsx scripts/migrations/add-commodity-prices-unique-index.ts --apply
 *
 *   Reads `MONGODB_URI_LIVE` if set, else falls back to `MONGODB_URI`.
 *
 * IDEMPOTENCY:
 *   `createIndex` is idempotent at the Mongo level (re-creating an identical
 *   index is a no-op). The script additionally stamps `migrationsRun._id =
 *   "add-commodity-prices-unique-index"`.
 */
import { MongoClient, Db } from "mongodb";
import * as dotenv from "dotenv";
import * as path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const MARKER_ID = "add-commodity-prices-unique-index";
const INDEX_NAME = "commodity_unique";

function resolveUri(): string {
  const live = process.env.MONGODB_URI_LIVE;
  const fallback = process.env.MONGODB_URI;
  const uri = live ?? fallback;
  if (!uri) throw new Error("Set MONGODB_URI_LIVE (or MONGODB_URI) in .env.local");
  if (live) console.log("[add-commodity-unique-index] using MONGODB_URI_LIVE");
  else console.log("[add-commodity-unique-index] using MONGODB_URI (fallback)");
  return uri;
}

async function verifyNoDuplicates(db: Db): Promise<boolean> {
  const dupes = await db
    .collection("commodityPrices")
    .aggregate([
      { $group: { _id: "$commodity", count: { $sum: 1 } } },
      { $match: { count: { $gt: 1 } } },
    ])
    .toArray();
  if (dupes.length === 0) {
    console.log("[add-commodity-unique-index] duplicate check: 0 commodities with >1 row ✓");
    return true;
  }
  console.error(`[add-commodity-unique-index] ABORT — duplicates present:`);
  for (const d of dupes) console.error(`  ${d._id}: ${d.count} rows`);
  console.error(
    `Run \`heal-commodity-prices-copper-duplicates.ts --apply\` (or clean manually) first.`
  );
  return false;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const uri = resolveUri();
  const client = new MongoClient(uri);
  await client.connect();
  const db: Db = client.db("a-house-divided");

  try {
    console.log(`\n[add-commodity-unique-index] mode=${apply ? "APPLY" : "DRY-RUN"}\n`);

    const ok = await verifyNoDuplicates(db);
    if (!ok) {
      process.exitCode = 1;
      return;
    }

    // List existing indexes so dry-run shows current state.
    const existing = await db.collection("commodityPrices").indexes();
    console.log("[add-commodity-unique-index] existing indexes on commodityPrices:");
    for (const idx of existing) {
      console.log(`  - ${idx.name}: keys=${JSON.stringify(idx.key)} unique=${idx.unique ?? false}`);
    }
    const already = existing.find(
      (i) => i.key?.commodity === 1 && Object.keys(i.key).length === 1 && i.unique === true
    );
    if (already) {
      console.log(
        `[add-commodity-unique-index] index already present (name=${already.name}) — no-op.`
      );
      if (apply) {
        await db
          .collection<{ _id: string }>("migrationsRun")
          .updateOne(
            { _id: MARKER_ID },
            { $set: { _id: MARKER_ID, completedAt: new Date(), note: "already-present" } },
            { upsert: true }
          );
        console.log(`[add-commodity-unique-index] stamped as ${MARKER_ID} (no-op).`);
      }
      return;
    }

    if (!apply) {
      console.log(
        `\n[add-commodity-unique-index] DRY-RUN complete. Would create unique index \`${INDEX_NAME}\` on { commodity: 1 }. Re-run with --apply to commit.`
      );
      return;
    }

    await db
      .collection("commodityPrices")
      .createIndex({ commodity: 1 }, { name: INDEX_NAME, unique: true });
    console.log(
      `[add-commodity-unique-index] created unique index \`${INDEX_NAME}\` on commodityPrices.{commodity:1}.`
    );

    await db
      .collection<{ _id: string }>("migrationsRun")
      .updateOne(
        { _id: MARKER_ID },
        { $set: { _id: MARKER_ID, completedAt: new Date(), indexName: INDEX_NAME } },
        { upsert: true }
      );
    console.log(`[add-commodity-unique-index] stamped as ${MARKER_ID}.`);
  } finally {
    await client.close();
  }
}

main().catch((e) => {
  console.error("[add-commodity-unique-index] failed:", e);
  process.exit(1);
});
