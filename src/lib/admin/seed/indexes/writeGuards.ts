import type { Db } from "mongodb";
import { ensureIndex } from "./helpers";

/**
 * Partial-unique indexes that block double-submit / double-vote races on
 * election entry, endorsements, governance votes, and cabinet/leadership
 * ballot rows.
 *
 * Absorbs:
 *   - scripts/migrations/deprecated/add-election-write-guard-indexes.ts
 *   - scripts/migrations/deprecated/add-governance-write-guard-indexes.ts
 *
 * Both migrations are idempotent and become no-ops once these indexes are
 * present from bootstrap.
 */
export async function seedWriteGuardIndexes(db: Db, log: (msg: string) => void) {
  log("Election write-guard indexes:");

  await ensureIndex(
    db,
    "electionCandidates",
    { characterId: 1 },
    {
      name: "unique_active_election_candidate_per_character",
      unique: true,
      partialFilterExpression: { status: "active" },
    },
    log
  );

  await ensureIndex(
    db,
    "statePartyCandidates",
    { stateId: 1, partyId: 1, characterId: 1 },
    {
      name: "unique_active_state_party_candidate_per_member",
      unique: true,
      partialFilterExpression: {
        status: "active",
        stateId: { $exists: true },
        partyId: { $exists: true },
      },
    },
    log
  );

  await ensureIndex(
    db,
    "nationalPartyCandidates",
    { partyId: 1, characterId: 1 },
    {
      name: "unique_active_national_party_candidate_per_member",
      unique: true,
      partialFilterExpression: {
        status: "active",
        partyId: { $exists: true },
      },
    },
    log
  );

  await ensureIndex(
    db,
    "nationalCommitteeCandidates",
    { partyId: 1, characterId: 1 },
    {
      name: "unique_active_national_committee_candidate_per_member",
      unique: true,
      partialFilterExpression: {
        status: "active",
        partyId: { $exists: true },
      },
    },
    log
  );

  await ensureIndex(
    db,
    "playerEndorsements",
    { characterId: 1, electionId: 1 },
    {
      name: "unique_active_player_endorsement_per_election",
      unique: true,
      partialFilterExpression: { isActive: true },
    },
    log
  );

  log("Governance write-guard indexes:");

  await ensureIndex(
    db,
    "nationalPartyVotes",
    { electionId: 1, voterId: 1 },
    { name: "unique_national_party_vote_per_voter", unique: true },
    log
  );

  await ensureIndex(
    db,
    "statePartyVotes",
    { electionId: 1, voterId: 1 },
    { name: "unique_state_party_vote_per_voter", unique: true },
    log
  );

  await ensureIndex(
    db,
    "nationalCommitteeVotes",
    { electionId: 1, voterId: 1 },
    { name: "unique_national_committee_vote_per_voter", unique: true },
    log
  );

  await ensureIndex(
    db,
    "shareOffers",
    { listingId: 1, buyerCharacterId: 1 },
    {
      name: "unique_pending_share_offer_per_buyer_listing",
      unique: true,
      partialFilterExpression: { status: "pending" },
    },
    log
  );

  await ensureIndex(
    db,
    "cabinetNominations",
    { countryId: 1, positionId: 1 },
    {
      name: "unique_active_cabinet_nomination_per_position",
      unique: true,
      partialFilterExpression: { status: "active" },
    },
    log
  );

  await ensureIndex(
    db,
    "speakerLeadershipBallots",
    { voterCharacterId: 1 },
    { name: "unique_speaker_ballot_per_voter", unique: true },
    log
  );

  await ensureIndex(
    db,
    "houseLeadershipBallots",
    { role: 1, voterCharacterId: 1 },
    { name: "unique_house_leadership_ballot_per_voter", unique: true },
    log
  );

  await ensureIndex(
    db,
    "senateLeadershipBallots",
    { role: 1, voterCharacterId: 1 },
    { name: "unique_senate_leadership_ballot_per_voter", unique: true },
    log
  );

  await ensureIndex(
    db,
    "corporationCeoVotes",
    { corporationId: 1, voterCharacterId: 1 },
    { name: "unique_corporation_ceo_vote_per_shareholder", unique: true },
    log
  );

  // From 2026-05-07-backfill-corporation-isprivate.ts — race guard against
  // duplicate open privatization votes per corp. The vote-open code checks for
  // an existing open vote, but two concurrent opens can both pass the check
  // before either inserts; this partial unique index is the only race-free guard.
  await ensureIndex(
    db,
    "corporationPrivatizationVotes",
    { corporationId: 1 },
    {
      name: "uniq_open_vote_per_corp",
      unique: true,
      partialFilterExpression: { status: "open" },
    },
    log
  );

  // Same race guard for the generic corporationVotes collection (mirrors the
  // privatization-vote guard; see 2026-05-07-set-legal-structure-defaults.ts).
  await ensureIndex(
    db,
    "corporationVotes",
    { corporationId: 1 },
    {
      name: "uniq_open_vote_per_corp",
      unique: true,
      partialFilterExpression: { status: "open" },
    },
    log
  );

  // One-party-state regime invariant: at most one party per country may carry
  // regimeStatus: "ruling". The admin regime-status endpoint does a
  // demote-then-promote sequence outside a transaction; this partial unique
  // index is the race-free guard that prevents a concurrent promote from
  // landing two ruling parties in the same country.
  await ensureIndex(
    db,
    "politicalParties",
    { countryId: 1, regimeStatus: 1 },
    {
      name: "uniq_ruling_party_per_country",
      unique: true,
      partialFilterExpression: { regimeStatus: "ruling" },
    },
    log
  );

  log("Write-guard indexes ensured");
}
