/**
 * cf-inconsistency-fix Phase 8 — move NPP `funds` from anchor (₳) units
 * to home-currency local units, matching the same shape we did for player
 * characters and party/caucus/state-party treasuries.
 *
 * Pre-migration: `npp.funds` was a single scalar in anchor units. Cost
 * constants (NPP_FUND_COSTS, calculateNppFundGeneration) were also anchor.
 * Post-migration: `npp.funds` is denominated in the NPP's home currency;
 * cost constants stay anchor and writers convert at the boundary.
 *
 * Conversion: npp.funds_local = npp.funds_anchor × homeFxRate(npp.countryId)
 *
 * For US NPPs at the current ~1.09 USD rate: ~9% bump in display value.
 * For JP NPPs: ~×117 (huge nominal increase, same purchasing power in ¥).
 *
 * GUARDED:
 *   - DRY RUN by default. Re-run with `--apply` to mutate.
 *   - `--live` targets MONGODB_URI_LIVE.
 *   - Aborts if any NPP has missing/invalid country FX rate.
 *
 * DEPLOYMENT ORDERING: this migration MUST run BEFORE the new code reaches
 * production, otherwise NPP fund generation and action processing will
 * mis-credit by the rate. Same constraint as the treasury-to-local migration.
 *
 * Stays local until reviewed (feedback_migrations_local_only).
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

  const rateDocs = await db
    .collection("exchangeRates")
    .find({})
    .project({ currencyCode: 1, rate: 1 })
    .toArray();
  const rateByCcy = new Map(rateDocs.map((r) => [r.currencyCode, r.rate]));

  const npps = await db
    .collection("npps")
    .find({ funds: { $exists: true, $gt: 0 } })
    .project({ _id: 1, name: 1, countryId: 1, funds: 1 })
    .toArray();

  const ops = [];
  const aborts = [];
  for (const n of npps) {
    const countryId = n.countryId ?? "US";
    const ccy = COUNTRY_CURRENCY_MAP[countryId];
    if (!ccy) {
      aborts.push(`  ${n._id} ${n.name}: unknown country ${countryId}`);
      continue;
    }
    const rate = rateByCcy.get(ccy);
    if (!rate || !Number.isFinite(rate) || rate <= 0) {
      aborts.push(`  ${n._id} ${n.name}: missing/invalid rate for ${ccy} (${rate})`);
      continue;
    }
    const newFunds = n.funds * rate;
    ops.push({ _id: n._id, name: n.name, countryId, oldFunds: n.funds, newFunds, ccy });
  }

  if (aborts.length > 0) {
    console.error(`ABORT: ${aborts.length} NPP(s) have missing/invalid FX rate or country:`);
    for (const a of aborts) console.error(a);
    process.exit(1);
  }

  console.log(`Will convert ${ops.length} NPP(s) with funds > 0.`);
  console.log("\nDRY RUN sample (first 8):");
  for (const o of ops.slice(0, 8)) {
    console.log(
      `  ${o._id} ${o.name.padEnd(28)} ${o.countryId}  ${o.oldFunds.toFixed(2)} ₳ → ${o.newFunds.toFixed(2)} ${o.ccy}`
    );
  }
  console.log(`\nBy country:`);
  const byCountry = new Map();
  for (const o of ops) {
    const v = byCountry.get(o.countryId) ?? { count: 0, totalOld: 0, totalNew: 0 };
    v.count++;
    v.totalOld += o.oldFunds;
    v.totalNew += o.newFunds;
    byCountry.set(o.countryId, v);
  }
  for (const [c, v] of byCountry) {
    console.log(
      `  ${c}: ${v.count} NPPs, totalFunds ${v.totalOld.toFixed(0)} → ${v.totalNew.toFixed(0)} ${COUNTRY_CURRENCY_MAP[c]}`
    );
  }

  if (!apply) {
    console.log(`\nDRY RUN (${useLive ? "LIVE" : "local"} DB). Re-run with --apply to mutate.`);
  } else {
    console.log(`\nAPPLYING (${useLive ? "LIVE" : "local"} DB)...`);
    const bulk = ops.map((o) => ({
      updateOne: { filter: { _id: o._id }, update: { $set: { funds: o.newFunds } } },
    }));
    if (bulk.length > 0) {
      const result = await db.collection("npps").bulkWrite(bulk);
      console.log(`Done. modifiedCount=${result.modifiedCount}`);
    } else {
      console.log("Nothing to update.");
    }
  }
} finally {
  await client.close();
}
