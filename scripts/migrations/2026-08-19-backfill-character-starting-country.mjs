/**
 * Backfill `startingCountryId` on every character that predates the field.
 *
 * Why: "Starting Nationality" on the profile used to read
 * `users.accountCountryId`, which is account-level and written only from the
 * player's FIRST ever character. After a world reset (or on a second
 * character) it showed the nationality of a character the player no longer
 * has, e.g. a DD character rendered as "United States" (ticket 1107).
 *
 * `startingCountryId` is now set at character creation. Existing characters
 * have no record of a nationality change, so the only defensible value is the
 * character's current `countryId`. That is exactly right for every character
 * that has not emigrated, and strictly better than the account-level value for
 * the rest.
 *
 * Guarded:
 *   - DRY RUN by default. `--apply` to mutate.
 *   - `--live` targets MONGODB_URI_LIVE.
 *   - Only touches characters where `startingCountryId` is missing, so it is
 *     idempotent and never overwrites a value set at creation.
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

const client = new MongoClient(uri);
try {
  await client.connect();
  const db = client.db();
  const characters = await db
    .collection("characters")
    .find({ startingCountryId: { $exists: false } })
    .project({ _id: 1, name: 1, countryId: 1 })
    .toArray();

  if (characters.length === 0) {
    console.log("No characters missing startingCountryId. Nothing to do.");
  } else {
    const ops = [];
    for (const c of characters) {
      if (!c.countryId) {
        console.error(`ABORT: character ${c._id} (${c.name}) has no countryId`);
        process.exit(1);
      }
      ops.push({
        updateOne: {
          filter: { _id: c._id },
          update: { $set: { startingCountryId: c.countryId } },
        },
      });
    }
    const byCountry = {};
    for (const c of characters) byCountry[c.countryId] = (byCountry[c.countryId] ?? 0) + 1;
    console.log(`${characters.length} characters to backfill:`);
    for (const [country, n] of Object.entries(byCountry).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${country}: ${n}`);
    }
    if (!apply) {
      console.log("\nDRY RUN. Re-run with --apply to write.");
    } else {
      const res = await db.collection("characters").bulkWrite(ops);
      console.log(`\nApplied. modified=${res.modifiedCount}`);
    }
  }
} finally {
  await client.close();
}
