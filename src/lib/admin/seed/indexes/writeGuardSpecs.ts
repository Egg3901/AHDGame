import type { CreateIndexesOptions, IndexSpecification } from "mongodb";

/**
 * THE write-guard index specs. One definition, two consumers.
 *
 * These partial-unique indexes are the race-free guards behind double-submit /
 * double-vote protection on election entry, endorsements, governance ballots,
 * cabinet nominations and corporate votes. They are created from two live
 * paths: `seedWriteGuardIndexes` at bootstrap, and the on-demand
 * `/api/admin/migrations/create-indexes` route.
 *
 * Both used to carry their own copy of the same ~15 specs (#591). Nothing had
 * drifted yet, but the failure mode is not hypothetical — #570 was exactly
 * this, realized: `embargoCooldowns` ended up with the seed's name in one place
 * and an auto-generated name in the other, and every embargo attempt 500'd on
 * `IndexOptionsConflict`. A rename or a tightened `partialFilterExpression`
 * applied to one file and not the other splits bootstrap-seeded environments
 * from route-repaired ones, and the symptom surfaces far from the edit.
 *
 * Ordering is preserved from the original seeder so bootstrap logs read the
 * same. Each entry is `[collection, keys, options]`.
 */
export type IndexSpecTuple = [string, IndexSpecification, CreateIndexesOptions];

/** Election-entry and endorsement guards. */
export const ELECTION_WRITE_GUARD_INDEXES: IndexSpecTuple[] = [
  [
    "electionCandidates",
    { characterId: 1 },
    {
      name: "unique_active_election_candidate_per_character",
      unique: true,
      partialFilterExpression: { status: "active" },
    },
  ],
  [
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
  ],
  [
    "nationalPartyCandidates",
    { partyId: 1, characterId: 1 },
    {
      name: "unique_active_national_party_candidate_per_member",
      unique: true,
      partialFilterExpression: { status: "active", partyId: { $exists: true } },
    },
  ],
  [
    "nationalCommitteeCandidates",
    { partyId: 1, characterId: 1 },
    {
      name: "unique_active_national_committee_candidate_per_member",
      unique: true,
      partialFilterExpression: { status: "active", partyId: { $exists: true } },
    },
  ],
  [
    "playerEndorsements",
    { characterId: 1, electionId: 1 },
    {
      name: "unique_active_player_endorsement_per_election",
      unique: true,
      partialFilterExpression: { isActive: true },
    },
  ],
];

/** Governance ballot, cabinet and corporate-vote guards. */
export const GOVERNANCE_WRITE_GUARD_INDEXES: IndexSpecTuple[] = [
  [
    "nationalPartyVotes",
    { electionId: 1, voterId: 1 },
    { name: "unique_national_party_vote_per_voter", unique: true },
  ],
  [
    "statePartyVotes",
    { electionId: 1, voterId: 1 },
    { name: "unique_state_party_vote_per_voter", unique: true },
  ],
  [
    "nationalCommitteeVotes",
    { electionId: 1, voterId: 1 },
    { name: "unique_national_committee_vote_per_voter", unique: true },
  ],
  [
    "shareOffers",
    { listingId: 1, buyerCharacterId: 1 },
    {
      name: "unique_pending_share_offer_per_buyer_listing",
      unique: true,
      partialFilterExpression: { status: "pending" },
    },
  ],
  [
    "cabinetNominations",
    { countryId: 1, positionId: 1 },
    {
      name: "unique_active_cabinet_nomination_per_position",
      unique: true,
      partialFilterExpression: { status: "active" },
    },
  ],
  [
    "speakerLeadershipBallots",
    { voterCharacterId: 1 },
    { name: "unique_speaker_ballot_per_voter", unique: true },
  ],
  [
    "houseLeadershipBallots",
    { role: 1, voterCharacterId: 1 },
    { name: "unique_house_leadership_ballot_per_voter", unique: true },
  ],
  [
    "senateLeadershipBallots",
    { role: 1, voterCharacterId: 1 },
    { name: "unique_senate_leadership_ballot_per_voter", unique: true },
  ],
  [
    "corporationCeoVotes",
    { corporationId: 1, voterCharacterId: 1 },
    { name: "unique_corporation_ceo_vote_per_shareholder", unique: true },
  ],
  // Race guard against duplicate open privatization votes per corp. The
  // vote-open code checks for an existing open vote, but two concurrent opens
  // can both pass the check before either inserts; this partial unique index
  // is the only race-free guard.
  [
    "corporationPrivatizationVotes",
    { corporationId: 1 },
    {
      name: "uniq_open_vote_per_corp",
      unique: true,
      partialFilterExpression: { status: "open" },
    },
  ],
  // Same race guard for the generic corporationVotes collection.
  [
    "corporationVotes",
    { corporationId: 1 },
    {
      name: "uniq_open_vote_per_corp",
      unique: true,
      partialFilterExpression: { status: "open" },
    },
  ],
  // One-party-state regime invariant: at most one party per country may carry
  // regimeStatus "ruling". The admin regime-status endpoint does a
  // demote-then-promote sequence outside a transaction; this partial unique
  // index is the race-free guard that prevents a concurrent promote from
  // landing two ruling parties in the same country.
  [
    "politicalParties",
    { countryId: 1, regimeStatus: 1 },
    {
      name: "uniq_ruling_party_per_country",
      unique: true,
      partialFilterExpression: { regimeStatus: "ruling" },
    },
  ],
];

/** Every write-guard index, in bootstrap order. */
export const ALL_WRITE_GUARD_INDEXES: IndexSpecTuple[] = [
  ...ELECTION_WRITE_GUARD_INDEXES,
  ...GOVERNANCE_WRITE_GUARD_INDEXES,
];
