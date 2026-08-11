/**
 * Backfill: set `isPrivate: false` on every existing corporation that lacks the field.
 *
 * Background: the new private/public corporation feature treats the absence of
 * `isPrivate` as legacy state. Every corp that existed before this feature was
 * fully public — financials visible to all viewers, no fog of war. To preserve
 * that observed behavior, we explicitly stamp `isPrivate: false` on legacy docs.
 *
 * Why safe: only touches docs where the field is absent (`{ isPrivate: { $exists: false } }`),
 * and sets the same value the redaction helper would derive from a missing field.
 * Idempotent — re-running on a backfilled DB matches 0 documents.
 *
 * Run AFTER: deploying the route changes that read `isPrivate`. Reading code
 * already treats absence as "false", so order is forgiving.
 *
 * Usage:
 *   # Dry run (default):
 *   npx tsx scripts/migrations/2026-05-07-backfill-corporation-isprivate.ts
 *
 *   # Apply for real:
 *   npx tsx scripts/migrations/2026-05-07-backfill-corporation-isprivate.ts --apply
 *
 *   # Custom DB:
 *   npx tsx scripts/migrations/2026-05-07-backfill-corporation-isprivate.ts --db=local
 *
 * Idempotent: re-running matches 0 documents.
 */
import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { MongoClient } from "mongodb";

function loadEnvLocal(): string | null {
  const candidates = [
    path.resolve(process.cwd(), ".env.local"),
    path.resolve(process.cwd(), "../.env.local"),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

const envFile = loadEnvLocal();
if (envFile) dotenv.config({ path: envFile });

const apply = process.argv.includes("--apply");
const dbArg = process.argv.find((a) => a.startsWith("--db="));
const dbName = dbArg ? dbArg.slice("--db=".length) : "a-house-divided";

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error("Missing MONGODB_URI in env");
    process.exit(1);
  }
  const client = new MongoClient(uri);
  await client.connect();
  try {
    const db = client.db(dbName);
    const filter = { isPrivate: { $exists: false } };
    const matchCount = await db.collection("corporations").countDocuments(filter);
    console.log(`Corps without isPrivate: ${matchCount}`);

    // Partial unique index against duplicate open privatization votes per corp.
    // The vote-open code checks for an existing open vote, but two concurrent
    // opens can both pass the check before either inserts. The partial unique
    // index is the only race-free guard.
    const votesIdx = await db.collection("corporationPrivatizationVotes").listIndexes().toArray();
    const haveOpenIdx = votesIdx.some((i) => i.name === "uniq_open_vote_per_corp");
    console.log(
      `corporationPrivatizationVotes uniq_open_vote_per_corp index present: ${haveOpenIdx}`
    );

    if (!apply) {
      console.log("Dry run — pass --apply to write.");
      return;
    }
    const result = await db
      .collection("corporations")
      .updateMany(filter, { $set: { isPrivate: false } });
    console.log(`Updated ${result.modifiedCount} corp documents.`);

    if (!haveOpenIdx) {
      await db.collection("corporationPrivatizationVotes").createIndex(
        { corporationId: 1 },
        {
          name: "uniq_open_vote_per_corp",
          unique: true,
          partialFilterExpression: { status: "open" },
        }
      );
      console.log("Created partial unique index uniq_open_vote_per_corp.");
    }
  } finally {
    await client.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
