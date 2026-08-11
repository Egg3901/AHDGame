/**
 * Migration: add unique indexes for remaining governance and market write guards.
 *
 * Prevents concurrent duplicate writes on:
 * - nationalPartyVotes / statePartyVotes / nationalCommitteeVotes
 * - shareOffers (one pending offer per buyer per listing)
 * - cabinetNominations (one active nomination per cabinet position)
 * - speaker / House / Senate leadership ballot claims
 * - corporation CEO vote rows
 */

import { closeDb, connectDb } from "../../utils/db";

async function migrate() {
  console.log("Adding governance write-guard indexes...");
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
    "nationalPartyVotes",
    { electionId: 1, voterId: 1 },
    "unique_national_party_vote_per_voter",
    { unique: true }
  );

  await ensure(
    "statePartyVotes",
    { electionId: 1, voterId: 1 },
    "unique_state_party_vote_per_voter",
    { unique: true }
  );

  await ensure(
    "nationalCommitteeVotes",
    { electionId: 1, voterId: 1 },
    "unique_national_committee_vote_per_voter",
    { unique: true }
  );

  await ensure(
    "shareOffers",
    { listingId: 1, buyerCharacterId: 1 },
    "unique_pending_share_offer_per_buyer_listing",
    {
      unique: true,
      partialFilterExpression: { status: "pending" },
    }
  );

  await ensure(
    "cabinetNominations",
    { countryId: 1, positionId: 1 },
    "unique_active_cabinet_nomination_per_position",
    {
      unique: true,
      partialFilterExpression: { status: "active" },
    }
  );

  await ensure(
    "speakerLeadershipBallots",
    { voterCharacterId: 1 },
    "unique_speaker_ballot_per_voter",
    { unique: true }
  );

  await ensure(
    "houseLeadershipBallots",
    { role: 1, voterCharacterId: 1 },
    "unique_house_leadership_ballot_per_voter",
    { unique: true }
  );

  await ensure(
    "senateLeadershipBallots",
    { role: 1, voterCharacterId: 1 },
    "unique_senate_leadership_ballot_per_voter",
    { unique: true }
  );

  await ensure(
    "corporationCeoVotes",
    { corporationId: 1, voterCharacterId: 1 },
    "unique_corporation_ceo_vote_per_shareholder",
    { unique: true }
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
