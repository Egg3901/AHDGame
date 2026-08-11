/**
 * cf-inconsistency-fix Phase 8 — orphan reconciliation.
 *
 * 7 never-logged-in seeded characters have `cashOnHand > 0` but no entry in
 * `currencyBalances.personal[homeCurrency]`. Identified by the
 * 2026-05-18-drop-cash-on-hand.mjs orphan guard.
 *
 * Reconciliation: convert each orphan's `cashOnHand` (interpreted as ANCHOR
 * units, matching the admin-grant convention pre-Phase-8) to the character's
 * home currency at the current FX rate, then deposit into
 * `currencyBalances.personal[homeCurrency]`. Leaves `cashOnHand` in place so
 * the drop migration can `$unset` it cleanly afterward.
 *
 * Guarded:
 *   - DRY RUN by default. Re-run with `--apply` to mutate.
 *   - `--live` targets MONGODB_URI_LIVE.
 *   - Hardcoded list of 7 orphan IDs; will not touch any other characters.
 *
 * After this script: re-run 2026-05-18-drop-cash-on-hand.mjs — orphan guard
 * should clear and the drop migration can proceed.
 */

import { MongoClient, ObjectId } from "mongodb";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const args = new Set(process.argv.slice(2));
const useLive = args.has("--live");
const apply = args.has("--apply");

const uri = useLive ? process.env.MONGODB_URI_LIVE : process.env.MONGODB_URI;
if (!uri) {
  console.error(
    `MISSING env: ${useLive ? "MONGODB_URI_LIVE" : "MONGODB_URI"} is not set in .env.local`
  );
  process.exit(1);
}

const ORPHAN_IDS = [
  "69d9c2dbfdba5b05cb325ef1", // Bob the Builder (DE)
  "69da0db04c89fa3b18f6775a", // Super Mario (JP)
  "69dd4e1447a87ab390110b36", // Kevin Piastri (UK)
  "69e1a24841068a7882cc02fd", // Mark O'Rubio (US)
  "69e473c606a4c91176dfa3b5", // Andy Burnham (DE)
  "6a02bba367f084d3bc4e6142", // Erik Thälmann (DE)
  "6a0371b367f084d3bc4eb3ae", // Lenis (DE)
];

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
  const rateByCurrency = new Map(rateDocs.map((r) => [r.currencyCode, r.rate]));

  const plan = [];
  for (const idStr of ORPHAN_IDS) {
    const _id = new ObjectId(idStr);
    const c = await db.collection("characters").findOne({ _id });
    if (!c) {
      console.error(`NOT FOUND: ${idStr}`);
      process.exit(1);
    }
    if (c.lastActivity) {
      console.error(
        `ABORT: ${c._id} (${c.name}) has lastActivity=${c.lastActivity.toISOString?.()} — not a seeded orphan anymore. Refusing to touch.`
      );
      process.exit(1);
    }
    const cashOnHand = c.cashOnHand ?? 0;
    if (cashOnHand <= 0) {
      console.log(`SKIP ${c._id} (${c.name}): cashOnHand=${cashOnHand} (nothing to migrate)`);
      continue;
    }
    const homeCurrency = COUNTRY_CURRENCY_MAP[c.countryId];
    if (!homeCurrency) {
      console.error(`ABORT: ${c._id} (${c.name}) unknown country ${c.countryId}`);
      process.exit(1);
    }
    const rate = rateByCurrency.get(homeCurrency);
    if (!rate || !Number.isFinite(rate) || rate <= 0) {
      console.error(
        `ABORT: ${c._id} (${c.name}) missing/invalid rate for ${homeCurrency} (got ${rate})`
      );
      process.exit(1);
    }
    // cashOnHand is anchor (per admin-grant convention); convert to home currency.
    const localAmount = cashOnHand * rate;
    const existingLocal = c.currencyBalances?.personal?.[homeCurrency] ?? 0;
    plan.push({
      _id,
      name: c.name,
      countryId: c.countryId,
      homeCurrency,
      cashOnHand,
      rate,
      localAmount,
      existingLocal,
      newLocal: existingLocal + localAmount,
    });
  }

  console.log(`Will reconcile ${plan.length} orphan(s):`);
  for (const p of plan) {
    console.log(
      `  ${p._id} ${p.name.padEnd(22)} (${p.countryId})  cashOnHand=${p.cashOnHand.toFixed(2)} ₳ → +${p.localAmount.toFixed(2)} ${p.homeCurrency} (existing ${p.existingLocal} → ${p.newLocal.toFixed(2)})`
    );
  }

  if (!apply) {
    console.log(`\nDRY RUN (${useLive ? "LIVE" : "local"} DB). Re-run with --apply to mutate.`);
  } else {
    console.log(`\nAPPLYING (${useLive ? "LIVE" : "local"} DB)...`);
    for (const p of plan) {
      const path = `currencyBalances.personal.${p.homeCurrency}`;
      const result = await db
        .collection("characters")
        .updateOne({ _id: p._id }, { $inc: { [path]: p.localAmount } });
      console.log(
        `  ${p._id} ${p.name}: ${result.modifiedCount === 1 ? "OK" : "MISSED"} (+${p.localAmount.toFixed(2)} ${p.homeCurrency})`
      );
    }
    console.log("\nDone. Re-run 2026-05-18-drop-cash-on-hand.mjs to verify orphan guard clears.");
  }
} finally {
  await client.close();
}
