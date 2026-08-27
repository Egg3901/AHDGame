/**
 * Convert every `peaceOffers` row from the old `indemnity` field to the `term`
 * union introduced by the peace terms work.
 *
 * Every existing offer is an indemnity by definition, since it was the only term
 * that existed, so the conversion is total and lossless.
 *
 * ONE SHOT, not a dual-read period. An offer lives 72 turns and few are open at
 * any moment, so a compatibility branch in the reader would outlive the data it
 * served. Run this in the same deploy as the code.
 *
 * Idempotent: rows already carrying `term` do not match the filter.
 *
 * Usage:
 *   node scripts/migrations/2026-08-27-peace-offer-term.mjs           # report only
 *   node scripts/migrations/2026-08-27-peace-offer-term.mjs --apply   # write
 */
import { MongoClient } from "mongodb";

const APPLY = process.argv.includes("--apply");
const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error("MONGODB_URI is required.");
  process.exit(1);
}

const client = new MongoClient(uri);
await client.connect();

try {
  const db = client.db();
  const offers = db.collection("peaceOffers");

  const stale = await offers.find({ indemnity: { $exists: true } }).toArray();
  const already = await offers.countDocuments({ term: { $exists: true } });

  console.log(`peaceOffers carrying the old field: ${stale.length}`);
  console.log(`peaceOffers already converted:      ${already}`);

  if (stale.length === 0) {
    console.log("Nothing to convert.");
  } else if (!APPLY) {
    for (const row of stale) {
      console.log(
        `  ${row._id}  ${row.fromCountry} -> ${row.toCountry}  ` +
          `${row.status}  payer=${row.indemnity?.payer} amount=${row.indemnity?.amount}`
      );
    }
    console.log("\nDry run. Re-run with --apply to write.");
  } else {
    let converted = 0;
    for (const row of stale) {
      // Guarded on the old field still being present, so a second runner cannot
      // overwrite a row the first has already converted.
      const result = await offers.updateOne(
        { _id: row._id, indemnity: { $exists: true } },
        {
          $set: {
            term: {
              kind: "indemnity",
              payer: row.indemnity.payer,
              amount: row.indemnity.amount,
            },
          },
          $unset: { indemnity: "" },
        }
      );
      converted += result.modifiedCount ?? 0;
    }
    console.log(`Converted ${converted} offer(s).`);
  }
} finally {
  await client.close();
}
