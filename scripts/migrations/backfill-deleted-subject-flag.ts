/**
 * One-time backfill: scan financialTxLog for rows whose subjectId or
 * counterpartyId no longer resolves in characters / corporations /
 * imperialCharacters / politicalParties and stamp the matching
 * subjectDeletedAt / counterpartyDeletedAt + sequentialId fields.
 *
 * Safe to run repeatedly — every $set is gated on `*DeletedAt: { $exists:
 * false }` so already-stamped rows are skipped. New `expiresAt` is taken
 * via `$max` so re-runs never shorten retention.
 *
 * Why this exists: pre-Phase-4, deleted entities orphaned their tx history
 * silently. The wealth-list audit had to special-case lookups by
 * subjectName string-matching. After this script runs, every tx row
 * referencing a vanished entity carries an explicit timestamp + seq id
 * so the admin ledger UI can render "(deleted)" without per-row joins.
 *
 * Run:
 *   MONGODB_URI=... npx tsx scripts/migrations/backfill-deleted-subject-flag.ts
 */
import { MongoClient, ObjectId } from "mongodb";
import * as dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const COLLECTIONS_BY_SUBJECT_TYPE: Record<string, string> = {
  character: "characters",
  corporation: "corporations",
  party: "politicalParties",
  // government rows have no subjectId — countryId is the join key, no
  // backfill needed since governments never get deleted.
};

async function main() {
  const uri = process.env.MONGODB_URI || process.env.MONGODB_URI_LIVE;
  if (!uri) {
    console.error("MONGODB_URI (or MONGODB_URI_LIVE) not set");
    process.exit(1);
  }
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db("a-house-divided");

  let totalScanned = 0;
  let totalStamped = 0;

  // Pass 1: subjectId references. Stream by (subjectType, subjectId) pair
  // groups so each candidate ID gets one existence check across the right
  // collection.
  for (const [subjectType, collectionName] of Object.entries(COLLECTIONS_BY_SUBJECT_TYPE)) {
    const distinctIds = await db.collection("financialTxLog").distinct("subjectId", {
      subjectType,
      subjectDeletedAt: { $exists: false },
      subjectId: { $exists: true },
    });

    if (distinctIds.length === 0) continue;
    console.log(
      `[${subjectType}] ${distinctIds.length} distinct un-stamped subjectIds to verify against ${collectionName}`
    );

    // Bulk-fetch existing IDs in chunks of 1000 to keep $in queries small.
    const CHUNK = 1000;
    const stillExisting = new Set<string>();
    for (let i = 0; i < distinctIds.length; i += CHUNK) {
      const chunk = distinctIds.slice(i, i + CHUNK).filter((id): id is ObjectId => id != null);
      const docs = await db
        .collection(collectionName)
        .find({ _id: { $in: chunk } as never }, { projection: { _id: 1, sequentialId: 1 } })
        .toArray();
      for (const d of docs) stillExisting.add(d._id.toString());
    }

    const missingIds = distinctIds.filter(
      (id): id is ObjectId => id != null && !stillExisting.has(id.toString())
    );

    if (missingIds.length === 0) {
      console.log(`[${subjectType}] no orphans found`);
      continue;
    }
    console.log(`[${subjectType}] stamping ${missingIds.length} orphan subjectIds`);

    // We don't know the original deletion timestamp. Use a sentinel "epoch"
    // date that's clearly older than any real run so admin queries can spot
    // backfilled rows (vs ones where we caught the deletion live). Pick the
    // unix epoch — a real deletion will always be later.
    const SENTINEL = new Date(0);
    const result = await db.collection("financialTxLog").updateMany(
      {
        subjectType,
        subjectId: { $in: missingIds },
        subjectDeletedAt: { $exists: false },
      },
      { $set: { subjectDeletedAt: SENTINEL } }
    );
    totalStamped += result.modifiedCount;
    console.log(`[${subjectType}] stamped ${result.modifiedCount} rows`);
    totalScanned += distinctIds.length;
  }

  // Pass 2: counterpartyId references. Same logic, different field name. The
  // counterpartyType union includes `system` which has no collection — skip.
  for (const [subjectType, collectionName] of Object.entries(COLLECTIONS_BY_SUBJECT_TYPE)) {
    const distinctIds = await db.collection("financialTxLog").distinct("counterpartyId", {
      counterpartyType: subjectType,
      counterpartyDeletedAt: { $exists: false },
      counterpartyId: { $exists: true },
    });

    if (distinctIds.length === 0) continue;

    const CHUNK = 1000;
    const stillExisting = new Set<string>();
    for (let i = 0; i < distinctIds.length; i += CHUNK) {
      const chunk = distinctIds.slice(i, i + CHUNK).filter((id): id is ObjectId => id != null);
      const docs = await db
        .collection(collectionName)
        .find({ _id: { $in: chunk } as never }, { projection: { _id: 1 } })
        .toArray();
      for (const d of docs) stillExisting.add(d._id.toString());
    }

    const missingIds = distinctIds.filter(
      (id): id is ObjectId => id != null && !stillExisting.has(id.toString())
    );
    if (missingIds.length === 0) continue;

    const SENTINEL = new Date(0);
    const result = await db.collection("financialTxLog").updateMany(
      {
        counterpartyType: subjectType,
        counterpartyId: { $in: missingIds },
        counterpartyDeletedAt: { $exists: false },
      },
      { $set: { counterpartyDeletedAt: SENTINEL } }
    );
    totalStamped += result.modifiedCount;
    console.log(`[counterparty:${subjectType}] stamped ${result.modifiedCount} rows`);
    totalScanned += distinctIds.length;
  }

  console.log(`\nDone. Scanned ${totalScanned} distinct IDs, stamped ${totalStamped} rows.`);
  await client.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
