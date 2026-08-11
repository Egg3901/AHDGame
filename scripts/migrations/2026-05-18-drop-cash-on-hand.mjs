/**
 * cf-inconsistency-fix Phase 8 — drop the legacy `cashOnHand` and
 * `savingsOnHand` fields from characters.
 *
 * After Phase 8 the canonical personal-cash balance lives in
 * `character.currencyBalances.personal[homeCurrency]`, and savings in
 * `character.currencyBalances.savings[homeCurrency]`. The single-pool
 * legacy fields are now redundant.
 *
 * GUARDED:
 *   - DRY RUN by default. Re-run with `--apply` to actually mutate.
 *   - Pass `--live` to target MONGODB_URI_LIVE instead of MONGODB_URI.
 *   - Aborts if any character has `cashOnHand` > 0 but no corresponding
 *     `currencyBalances.personal[homeCurrency]` entry — those rows would
 *     lose data and need manual reconciliation.
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
  console.error(
    `MISSING env: ${useLive ? "MONGODB_URI_LIVE" : "MONGODB_URI"} is not set in .env.local`
  );
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

  // Orphan guard: any character with non-zero `cashOnHand` but no per-currency
  // personal balance would lose that money. Halt and report.
  const cursor = db
    .collection("characters")
    .find({
      $or: [
        { cashOnHand: { $exists: true, $gt: 0 } },
        { savingsOnHand: { $exists: true, $gt: 0 } },
      ],
    })
    .project({
      _id: 1,
      name: 1,
      countryId: 1,
      cashOnHand: 1,
      savingsOnHand: 1,
      currencyBalances: 1,
    });

  const orphans = [];
  for await (const doc of cursor) {
    const countryId = doc.countryId ?? "US";
    const homeCurrency = COUNTRY_CURRENCY_MAP[countryId] ?? "USD";
    const personalBalance = doc.currencyBalances?.personal?.[homeCurrency];
    const savingsBalance = doc.currencyBalances?.savings?.[homeCurrency];

    const cashStranded = (doc.cashOnHand ?? 0) > 0 && (personalBalance ?? 0) === 0;
    const savingsStranded = (doc.savingsOnHand ?? 0) > 0 && (savingsBalance ?? 0) === 0;

    if (cashStranded || savingsStranded) {
      orphans.push({
        _id: doc._id,
        name: doc.name,
        countryId,
        cashOnHand: doc.cashOnHand,
        savingsOnHand: doc.savingsOnHand,
        homeCurrencyPersonal: personalBalance,
        homeCurrencySavings: savingsBalance,
      });
    }
  }

  if (orphans.length > 0) {
    console.error(
      `ABORT: ${orphans.length} character(s) have non-zero cashOnHand/savingsOnHand without a matching home-currency personal/savings balance:`
    );
    for (const o of orphans) {
      console.error(
        `  ${o._id}  ${o.name}  ${o.countryId}  cashOnHand=${o.cashOnHand}  savingsOnHand=${o.savingsOnHand}  personal[home]=${o.homeCurrencyPersonal}  savings[home]=${o.homeCurrencySavings}`
      );
    }
    console.error("\nMigrate these balances manually before re-running.");
    process.exit(1);
  }

  const matchFilter = {
    $or: [{ cashOnHand: { $exists: true } }, { savingsOnHand: { $exists: true } }],
  };
  const count = await db.collection("characters").countDocuments(matchFilter);

  if (!apply) {
    console.log(
      `DRY RUN (${useLive ? "LIVE" : "local"} DB): would $unset cashOnHand + savingsOnHand from ${count} character document(s).`
    );
    console.log("Re-run with --apply to mutate.");
  } else {
    console.log(
      `APPLYING (${useLive ? "LIVE" : "local"} DB): $unset cashOnHand + savingsOnHand from ${count} character document(s)...`
    );
    const result = await db
      .collection("characters")
      .updateMany(matchFilter, { $unset: { cashOnHand: "", savingsOnHand: "" } });
    console.log(`Done. modifiedCount=${result.modifiedCount}`);
  }
} finally {
  await client.close();
}
