/**
 * cf-inconsistency-fix follow-up — move party treasury-plan reserve targets
 * (`transferReserveAmount`, `memberSupportReserveAmount`,
 * `nppRecruitmentReserveAmount`) from anchor (₳) units to home-currency
 * local units.
 *
 * Background: Phase 6 moved `politicalParties.treasury`, `statePartyOrg.treasury`,
 * and `caucuses.treasury` to local. The matching soft-reserve fields on
 * `partyBudget` were left in anchor, so
 * `wouldTriggerTreasuryReserveOverride(treasury_local, amount_local, reserve_anchor)`
 * was comparing mismatched units (under-tripping by 1/rate). This migration
 * converts the stored reserves so the comparison is unit-clean again.
 *
 * Conversion (per partyBudget doc):
 *   reserve_local = reserve_anchor × homeFxRate(budget.countryId)
 *
 * GUARDED:
 *   - DRY RUN by default. Re-run with `--apply` to mutate.
 *   - Pass `--live` to target MONGODB_URI_LIVE instead of MONGODB_URI.
 *   - Aborts if any partyBudget has missing/invalid country FX rate.
 *   - Skips docs where all three reserve fields are 0 / missing (no-op rows).
 *
 * Idempotent guard: writes a `reservesLocalCurrencyVersion: 2026-05-19`
 * marker on each touched doc. Re-running with --apply will skip already-
 * migrated rows so the conversion can't double-apply.
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

const MIGRATION_VERSION = "2026-05-19";

const COUNTRY_CURRENCY_MAP = {
  US: "USD",
  UK: "GBP",
  JP: "JPY",
  DE: "EUR",
  BR: "BRL",
  CN: "CNY",
  NG: "NGN",
};

const RESERVE_FIELDS = [
  "transferReserveAmount",
  "memberSupportReserveAmount",
  "nppRecruitmentReserveAmount",
];

const client = new MongoClient(uri);

try {
  await client.connect();
  const db = client.db();

  // Load all exchange rates up front.
  const rateDocs = await db
    .collection("exchangeRates")
    .find({})
    .project({ currencyCode: 1, rate: 1 })
    .toArray();
  const rateByCurrency = new Map(rateDocs.map((r) => [r.currencyCode, r.rate]));

  const docs = await db
    .collection("partyBudget")
    .find({
      reservesLocalCurrencyVersion: { $ne: MIGRATION_VERSION },
      $or: [
        { transferReserveAmount: { $gt: 0 } },
        { memberSupportReserveAmount: { $gt: 0 } },
        { nppRecruitmentReserveAmount: { $gt: 0 } },
      ],
    })
    .project({
      _id: 1,
      countryId: 1,
      partyId: 1,
      scope: 1,
      stateId: 1,
      transferReserveAmount: 1,
      memberSupportReserveAmount: 1,
      nppRecruitmentReserveAmount: 1,
    })
    .toArray();

  let aborts = 0;
  const abortDetails = [];
  const ops = []; // { _id, label, currencyCode, rate, oldValues, newValues }

  for (const doc of docs) {
    const countryId = doc.countryId ?? "US";
    const currencyCode = COUNTRY_CURRENCY_MAP[countryId];
    if (!currencyCode) {
      aborts++;
      abortDetails.push(`  partyBudget/${doc._id}: unknown country ${countryId}`);
      continue;
    }
    const rate = rateByCurrency.get(currencyCode);
    if (!rate || !Number.isFinite(rate) || rate <= 0) {
      aborts++;
      abortDetails.push(`  partyBudget/${doc._id}: missing/invalid rate for ${currencyCode}`);
      continue;
    }

    const oldValues = {};
    const newValues = {};
    for (const field of RESERVE_FIELDS) {
      const v = doc[field];
      if (typeof v === "number" && Number.isFinite(v) && v > 0) {
        oldValues[field] = v;
        newValues[field] = v * rate;
      } else if (typeof v === "number" && v === 0) {
        oldValues[field] = 0;
        newValues[field] = 0;
      }
    }

    const label =
      doc.scope === "state"
        ? `${doc.countryId}/${doc.stateId}/${doc.partyId}`
        : `${doc.countryId}/national/${doc.partyId}`;
    ops.push({ _id: doc._id, label, currencyCode, rate, oldValues, newValues });
  }

  if (aborts > 0) {
    console.error(`ABORT: ${aborts} partyBudget row(s) have missing/invalid FX rate or country:`);
    for (const detail of abortDetails) console.error(detail);
    console.error("\nFix these rows manually before re-running.");
    process.exit(1);
  }

  console.log(
    `Will convert reserves on ${ops.length} partyBudget doc(s) using version marker "${MIGRATION_VERSION}".`
  );

  if (!apply) {
    console.log(`\nDRY RUN sample (first 10):`);
    for (const op of ops.slice(0, 10)) {
      const changes = RESERVE_FIELDS.filter((f) => f in op.oldValues && op.oldValues[f] !== 0).map(
        (f) =>
          `${f.replace("ReserveAmount", "")}: ${op.oldValues[f].toFixed(2)} ₳ → ${op.newValues[f].toFixed(2)} ${op.currencyCode}`
      );
      console.log(`  ${op.label} (rate ${op.rate})`);
      for (const c of changes) console.log(`    ${c}`);
    }
    console.log(`\nDRY RUN (${useLive ? "LIVE" : "local"} DB). Re-run with --apply to mutate.`);
  } else {
    console.log(`\nAPPLYING (${useLive ? "LIVE" : "local"} DB)...`);
    const bulkOps = ops.map((op) => ({
      updateOne: {
        filter: { _id: op._id, reservesLocalCurrencyVersion: { $ne: MIGRATION_VERSION } },
        update: {
          $set: {
            ...op.newValues,
            reservesLocalCurrencyVersion: MIGRATION_VERSION,
          },
        },
      },
    }));
    if (bulkOps.length === 0) {
      console.log("  Nothing to do — all rows already migrated.");
    } else {
      const result = await db.collection("partyBudget").bulkWrite(bulkOps);
      console.log(
        `  partyBudget: matchedCount=${result.matchedCount} modifiedCount=${result.modifiedCount}`
      );
    }
    console.log("Done.");
  }
} finally {
  await client.close();
}
