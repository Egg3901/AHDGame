/**
 * cf-inconsistency-fix Phase 5 — drop the legacy `character.funds` field.
 *
 * After Phases 0-4 + the inline-cleanup pass, no code reads or writes
 * `character.funds`; the canonical campaign-fund balance lives in
 * `character.currencyBalances.campaign` (in the character's home currency).
 *
 * This script $unsets `funds` from every character document. It is GUARDED:
 *
 *   - DRY RUN by default. Re-run with `--apply` to actually mutate.
 *   - Pass `--live` to target MONGODB_URI_LIVE instead of MONGODB_URI.
 *   - Aborts if any character has `funds` set but no
 *     `currencyBalances.campaign` — those characters would lose data,
 *     and need manual reconciliation first.
 *
 * Run AFTER deploying the cf-inconsistency-fix code. Migration commits stay
 * local until explicitly approved (per feedback_migrations_local_only).
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

const client = new MongoClient(uri);

try {
  await client.connect();
  const db = client.db();

  // Orphan guard: any character with `funds` set but no `currencyBalances.campaign`
  // would lose data if we proceed. Halt and report.
  const orphans = await db
    .collection("characters")
    .find({
      funds: { $exists: true },
      "currencyBalances.campaign": { $exists: false },
    })
    .project({ _id: 1, name: 1, funds: 1, countryId: 1 })
    .toArray();

  if (orphans.length > 0) {
    console.error(
      `ABORT: ${orphans.length} character(s) have \`funds\` but no \`currencyBalances.campaign\`:`
    );
    for (const o of orphans) {
      console.error(`  ${o._id}  ${o.name}  countryId=${o.countryId}  funds=${o.funds}`);
    }
    console.error(
      "\nThese characters were never migrated to the forex schema. Fix them manually before re-running."
    );
    process.exit(1);
  }

  const matchFilter = { funds: { $exists: true } };
  const count = await db.collection("characters").countDocuments(matchFilter);

  if (!apply) {
    console.log(
      `DRY RUN (${useLive ? "LIVE" : "local"} DB): would $unset funds from ${count} character document(s).`
    );
    console.log("Re-run with --apply to mutate.");
  } else {
    console.log(
      `APPLYING (${useLive ? "LIVE" : "local"} DB): $unset funds from ${count} character document(s)...`
    );
    const result = await db
      .collection("characters")
      .updateMany(matchFilter, { $unset: { funds: "" } });
    console.log(`Done. modifiedCount=${result.modifiedCount}`);
  }
} finally {
  await client.close();
}
