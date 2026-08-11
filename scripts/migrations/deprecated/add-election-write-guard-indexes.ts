/**
 * Migration: add unique indexes for election-entry and endorsement write guards.
 *
 * Prevents concurrent duplicate writes on:
 * - electionCandidates (one active race per character/NPP)
 * - statePartyCandidates (one active state-party leadership candidacy per member/state-party)
 * - nationalPartyCandidates (one active national-party leadership candidacy per member/party)
 * - nationalCommitteeCandidates (one active committee candidacy per member/party)
 * - playerEndorsements (one active endorsement per player/election)
 */

import { connectDb, closeDb } from "../../utils/db";

async function migrate() {
  console.log("Adding election write-guard indexes...");
  const db = await connectDb();

  const results: string[] = [];

  async function ensure(
    collection: string,
    key: Record<string, 1 | -1>,
    name: string,
    options: Record<string, unknown>
  ) {
    try {
      await db.collection(collection).createIndex(key, { name, ...options });
      results.push(`✓ ${collection}.${name}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("already exists")) {
        results.push(`= ${collection}.${name} (already exists)`);
      } else {
        results.push(`✗ ${collection}.${name}: ${msg}`);
      }
    }
  }

  await ensure(
    "electionCandidates",
    { characterId: 1 },
    "unique_active_election_candidate_per_character",
    {
      unique: true,
      partialFilterExpression: { status: "active" },
    }
  );

  await ensure(
    "statePartyCandidates",
    { stateId: 1, partyId: 1, characterId: 1 },
    "unique_active_state_party_candidate_per_member",
    {
      unique: true,
      partialFilterExpression: {
        status: "active",
        stateId: { $exists: true },
        partyId: { $exists: true },
      },
    }
  );

  await ensure(
    "nationalPartyCandidates",
    { partyId: 1, characterId: 1 },
    "unique_active_national_party_candidate_per_member",
    {
      unique: true,
      partialFilterExpression: {
        status: "active",
        partyId: { $exists: true },
      },
    }
  );

  await ensure(
    "nationalCommitteeCandidates",
    { partyId: 1, characterId: 1 },
    "unique_active_national_committee_candidate_per_member",
    {
      unique: true,
      partialFilterExpression: {
        status: "active",
        partyId: { $exists: true },
      },
    }
  );

  await ensure(
    "playerEndorsements",
    { characterId: 1, electionId: 1 },
    "unique_active_player_endorsement_per_election",
    {
      unique: true,
      partialFilterExpression: { isActive: true },
    }
  );

  await closeDb();

  console.log("\nResults:");
  results.forEach((result) => console.log(" ", result));
  console.log("\nDone.");
}

migrate().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
