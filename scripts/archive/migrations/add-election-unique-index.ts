/**
 * Migration: Add unique index on elections collection.
 *
 * Prevents duplicate concurrent elections for the same seat by adding a
 * sparse unique index on (electionType, state, senateClass) filtered to
 * elections with status "active" or "upcoming".
 *
 * Run with: npx tsx scripts/migrations/add-election-unique-index.ts
 *
 * Safe to re-run: MongoDB `createIndex` is idempotent when the index
 * already exists with the same options.
 *
 * Per elections-sync-audit recommendation (2026-02-25).
 */

import { MongoClient } from "mongodb";

async function run() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error("MONGODB_URI environment variable is not set.");
  }

  const client = new MongoClient(uri);
  try {
    await client.connect();
    const db = client.db("a-house-divided");
    const elections = db.collection("elections");

    // Unique compound index on active/upcoming elections to prevent
    // spawning a second election while one is already running for the
    // same seat.  senateClass is included so Class-I and Class-III
    // Senate elections don't collide.
    await elections.createIndex(
      {
        electionType: 1,
        state: 1,
        senateClass: 1,
      },
      {
        unique: true,
        // Only applies to active/upcoming elections; completed/expired
        // records are not covered so historical data is preserved.
        partialFilterExpression: { status: { $in: ["active", "upcoming"] } },
        sparse: true,
        name: "unique_active_election_per_seat",
        background: true,
      }
    );

    console.log("✓ Index 'unique_active_election_per_seat' created (or already existed).");
  } finally {
    await client.close();
  }
}

run().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
