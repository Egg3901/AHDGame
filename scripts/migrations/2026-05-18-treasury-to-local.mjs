/**
 * cf-inconsistency-fix Phase 6 — move party / caucus / state-party treasuries
 * from anchor (₳) units to home-currency local units.
 *
 * Pre-migration: `treasury` was a scalar stored in anchor units. Display
 * formatters treated it as USD because USD ≈ 1:1 with anchor pre-forex.
 * Post-migration: `treasury` is denominated in the party's home currency.
 *
 * Conversion formula:
 *   treasury_local = treasury_anchor × homeFxRate(party.countryId)
 *
 * For US parties at the current ~1.02 USD rate: ~2% bump in display value
 * (the value preserved across the migration; only the unit interpretation
 * changes).
 *
 * GUARDED:
 *   - DRY RUN by default. Re-run with `--apply` to mutate.
 *   - Pass `--live` to target MONGODB_URI_LIVE instead of MONGODB_URI.
 *   - Aborts if any party / caucus / state-party-org has missing or invalid
 *     country FX rate — those rows would silently mis-convert.
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

  // Load all exchange rates up front
  const rateDocs = await db
    .collection("exchangeRates")
    .find({})
    .project({ currencyCode: 1, rate: 1 })
    .toArray();
  const rateByCurrency = new Map(rateDocs.map((r) => [r.currencyCode, r.rate]));

  const collections = ["politicalParties", "caucuses", "statePartyOrg"];

  let totalPreviewRows = 0;
  let totalAborts = 0;
  const abortDetails = [];
  const ops = []; // { collection, _id, oldTreasury, newTreasury, currencyCode }

  for (const collName of collections) {
    const docs = await db
      .collection(collName)
      .find({ treasury: { $exists: true } })
      .project({ _id: 1, treasury: 1, countryId: 1, name: 1 })
      .toArray();

    for (const doc of docs) {
      const countryId = doc.countryId ?? "US";
      const currencyCode = COUNTRY_CURRENCY_MAP[countryId];
      if (!currencyCode) {
        totalAborts++;
        abortDetails.push(
          `  ${collName}/${doc._id} (${doc.name ?? "?"}): unknown country ${countryId}`
        );
        continue;
      }
      const rate = rateByCurrency.get(currencyCode);
      if (!rate || !Number.isFinite(rate) || rate <= 0) {
        totalAborts++;
        abortDetails.push(
          `  ${collName}/${doc._id} (${doc.name ?? "?"}): missing/invalid rate for ${currencyCode}`
        );
        continue;
      }
      const oldTreasury = doc.treasury ?? 0;
      const newTreasury = oldTreasury * rate;
      ops.push({ collection: collName, _id: doc._id, oldTreasury, newTreasury, currencyCode });
      totalPreviewRows++;
    }
  }

  if (totalAborts > 0) {
    console.error(`ABORT: ${totalAborts} row(s) have missing/invalid FX rate or country:`);
    for (const detail of abortDetails) console.error(detail);
    console.error("\nFix these rows manually before re-running.");
    process.exit(1);
  }

  console.log(`Will convert ${totalPreviewRows} treasury row(s) across ${collections.join(", ")}.`);

  if (!apply) {
    console.log(`\nDRY RUN sample (first 10):`);
    for (const op of ops.slice(0, 10)) {
      console.log(
        `  ${op.collection}/${op._id}  ${op.oldTreasury.toFixed(2)} ₳ → ${op.newTreasury.toFixed(2)} ${op.currencyCode}`
      );
    }
    console.log(`\nDRY RUN (${useLive ? "LIVE" : "local"} DB). Re-run with --apply to mutate.`);
  } else {
    console.log(`\nAPPLYING (${useLive ? "LIVE" : "local"} DB)...`);
    const bulkByCollection = new Map();
    for (const op of ops) {
      const ops_for_coll = bulkByCollection.get(op.collection) ?? [];
      ops_for_coll.push({
        updateOne: {
          filter: { _id: op._id },
          update: { $set: { treasury: op.newTreasury } },
        },
      });
      bulkByCollection.set(op.collection, ops_for_coll);
    }
    for (const [collName, bulkOps] of bulkByCollection) {
      const result = await db.collection(collName).bulkWrite(bulkOps);
      console.log(`  ${collName}: modifiedCount=${result.modifiedCount}`);
    }
    console.log("Done.");
  }
} finally {
  await client.close();
}
