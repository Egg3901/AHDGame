/**
 * Backfill: FX-correct `anchorAmount` on historical index-fund financialTxLog
 * rows, then clear the spurious `cash_mismatch` suspect flags those inflated
 * values produced.
 *
 * Background: index_fund_subscribe/redeem/dividend rows stored `anchorAmount`
 * equal to the fund's native-currency amount instead of the internal-anchor
 * (USD-eq) value — ~114× too large for JPY funds. The suspectScan cash_mismatch
 * detector compares logged net (anchorAmount) vs FX-correct portfolioHistory
 * and therefore fired huge phantom-flow flags. The code fix stops new rows from
 * regressing; this repairs existing rows. Player cash balances are NOT touched.
 *
 * Dry-run by default. Run:
 *   railway run --service "Main Site" node scripts/backfill-fund-tx-anchor.mjs           # preview
 *   railway run --service "Main Site" APPLY=1 node scripts/backfill-fund-tx-anchor.mjs   # write anchorAmount
 *   railway run --service "Main Site" APPLY=1 CLEAR_FLAGS=1 node scripts/backfill-fund-tx-anchor.mjs
 *
 * NOTE: conversion uses the CURRENT exchangeRates table. anchorAmount is a
 * cross-currency snapshot, so this is an approximation where FX has drifted
 * since a row was written; it is vastly closer than the unconverted value and
 * good enough for the suspect scanner. If precise historical FX is required,
 * extend this to read portfolioHistory.exchangeRatesSnapshot by turn.
 */
import { MongoClient } from "mongodb";

const MONGO_URL = process.env.MONGO_URL || process.env.MONGODB_URI;
if (!MONGO_URL) throw new Error("Set MONGO_URL or MONGODB_URI");
const DB_NAME = process.env.MONGODB_DB || process.env.MONGO_DB_NAME || "a-house-divided";
const APPLY = process.env.APPLY === "1";
const CLEAR_FLAGS = process.env.CLEAR_FLAGS === "1";

const FUND_TYPES = ["index_fund_subscribe", "index_fund_redeem", "index_fund_dividend"];
const EPSILON = 0.01; // anchor units; skip rows already within tolerance

const fmt = (n) =>
  typeof n === "number" ? n.toLocaleString("en-US", { maximumFractionDigits: 2 }) : String(n);

const client = new MongoClient(MONGO_URL, { serverSelectionTimeoutMS: 15000 });
await client.connect();
const db = client.db(DB_NAME);
console.log(`DB: ${DB_NAME} | APPLY=${APPLY} | CLEAR_FLAGS=${CLEAR_FLAGS}\n`);

// ── Load FX rates (local per internal unit) ───────────────────────────────────
const rates = {};
for (const r of await db.collection("exchangeRates").find({}).toArray()) {
  rates[r.currencyCode] = r.rate;
}
console.log("FX rates:", rates, "\n");

// ── Step 1: recompute anchorAmount ────────────────────────────────────────────
const cursor = db.collection("financialTxLog").find({ type: { $in: FUND_TYPES } });
let scanned = 0;
let toFix = 0;
let skippedNoRate = 0;
const byCurrency = {};
const ops = [];

for await (const row of cursor) {
  scanned++;
  const rate = rates[row.currencyCode];
  if (!rate || rate <= 0) {
    skippedNoRate++;
    continue;
  }
  const correct = (row.amount ?? 0) / rate;
  const current = row.anchorAmount ?? 0;
  if (Math.abs(correct - current) <= EPSILON) continue;

  toFix++;
  byCurrency[row.currencyCode] = (byCurrency[row.currencyCode] ?? 0) + 1;
  if (ops.length < 6) {
    console.log(
      `  ${row.currencyCode} | amount=${fmt(row.amount)} | anchor ${fmt(current)} -> ${fmt(correct)}`
    );
  }
  ops.push({
    updateOne: {
      filter: { _id: row._id },
      update: { $set: { anchorAmount: Math.round(correct * 100) / 100 } },
    },
  });
}

console.log(
  `\nStep 1: scanned ${scanned} fund rows | need fix ${toFix} | no-rate skipped ${skippedNoRate}`
);
console.log("  by currency:", byCurrency);

if (APPLY && ops.length > 0) {
  // batch to keep bulkWrite payloads reasonable
  const BATCH = 1000;
  let written = 0;
  for (let i = 0; i < ops.length; i += BATCH) {
    const res = await db
      .collection("financialTxLog")
      .bulkWrite(ops.slice(i, i + BATCH), { ordered: false });
    written += res.modifiedCount;
  }
  console.log(`  APPLIED: ${written} rows updated.`);
} else if (!APPLY) {
  console.log("  DRY RUN — re-run with APPLY=1 to write.");
}

// ── Step 2 (optional): clear cash_mismatch flags driven by the bug ────────────
const mismatchFilter = { "suspectFlags.type": "cash_mismatch" };
const flaggedCount = await db.collection("financialTxLog").countDocuments(mismatchFilter);
console.log(`\nStep 2: rows carrying cash_mismatch flags: ${flaggedCount}`);

if (CLEAR_FLAGS && APPLY) {
  // Pull the cash_mismatch flags; recompute `flagged` from whatever remains.
  const pull = await db
    .collection("financialTxLog")
    .updateMany(mismatchFilter, { $pull: { suspectFlags: { type: "cash_mismatch" } } });
  // Any doc now left with an empty suspectFlags array should have flagged=false.
  const reflag = await db
    .collection("financialTxLog")
    .updateMany(
      { suspectFlags: { $size: 0 } },
      { $set: { flagged: false }, $unset: { suspectFlags: "" } }
    );
  console.log(
    `  CLEARED cash_mismatch on ${pull.modifiedCount} rows; reset flagged on ${reflag.modifiedCount}.`
  );
  console.log("  Let the next scheduled suspectScan re-evaluate against corrected anchorAmount.");
} else {
  console.log(
    "  (skipped — set APPLY=1 CLEAR_FLAGS=1 to clear; they will not re-fire once anchorAmount is fixed)"
  );
}

await client.close();
console.log("\nDone.");
