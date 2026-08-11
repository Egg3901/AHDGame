/**
 * Backfill `currencyCode` on the 1 bond missing it
 * (id 69e805b1c4996b819f772cf4 — matured SuperSpark Agencies bond, US corp).
 *
 * Pattern: derive currencyCode from `countryId` via COUNTRY_CURRENCY_MAP.
 *
 * Guarded:
 *   - DRY RUN by default. `--apply` to mutate.
 *   - `--live` targets MONGODB_URI_LIVE.
 *   - Only touches bonds with `currencyCode` missing (idempotent if re-run).
 */

import { MongoClient } from "mongodb";
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const args = new Set(process.argv.slice(2));
const useLive = args.has("--live");
const apply = args.has("--apply");

const uri = useLive ? process.env.MONGODB_URI_LIVE : process.env.MONGODB_URI;
if (!uri) {
  console.error(`MISSING env: ${useLive ? "MONGODB_URI_LIVE" : "MONGODB_URI"} not set`);
  process.exit(1);
}

const COUNTRY_CURRENCY_MAP = {
  US: "USD",
  UK: "GBP",
  JP: "JPY",
  DE: "EUR",
  BR: "BRL",
  CN: "CNY",
  NG: "NGN",
};

const client = new MongoClient(uri);
try {
  await client.connect();
  const db = client.db();
  const bonds = await db
    .collection("bonds")
    .find({ currencyCode: { $exists: false } })
    .project({ _id: 1, countryId: 1, issuerName: 1 })
    .toArray();

  if (bonds.length === 0) {
    console.log("No bonds missing currencyCode. Nothing to do.");
  } else {
    const ops = [];
    for (const b of bonds) {
      const ccy = COUNTRY_CURRENCY_MAP[b.countryId];
      if (!ccy) {
        console.error(`ABORT: ${b._id} ${b.issuerName} has unknown countryId=${b.countryId}`);
        process.exit(1);
      }
      console.log(`  ${b._id} ${b.issuerName} (${b.countryId}) → set currencyCode=${ccy}`);
      ops.push({ updateOne: { filter: { _id: b._id }, update: { $set: { currencyCode: ccy } } } });
    }
    if (!apply) {
      console.log(`\nDRY RUN (${useLive ? "LIVE" : "local"}). Would update ${ops.length} bond(s).`);
    } else {
      console.log(`\nAPPLYING (${useLive ? "LIVE" : "local"})...`);
      const result = await db.collection("bonds").bulkWrite(ops);
      console.log(`Done. modifiedCount=${result.modifiedCount}`);
    }
  }
} finally {
  await client.close();
}
