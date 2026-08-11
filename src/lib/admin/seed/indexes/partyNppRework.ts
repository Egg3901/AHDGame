import type { Db } from "mongodb";
import { ensureIndex } from "./helpers";

/**
 * Indexes for caucuses, recruitment slates, NPP cross-pressure / endorsements,
 * political capital, and treasury transactions — every collection introduced
 * by the party-NPP rework (Phases 1-9).
 *
 * Absorbs `scripts/migrations/deprecated/add-party-npp-rework-indexes.ts`. The migration
 * also dropped a legacy `recruitmentSlates_electionId` index and de-duplicated
 * a couple of collections before applying these — both are one-time live-data
 * repairs, not part of the seed contract, so they stay in the migration file
 * and are not folded in here.
 */
export async function seedPartyNppReworkIndexes(db: Db, log: (msg: string) => void) {
  log("Caucus indexes:");

  await ensureIndex(
    db,
    "caucuses",
    { countryId: 1, partyId: 1, slug: 1 },
    { name: "caucuses_country_party_slug" },
    log
  );
  await ensureIndex(
    db,
    "caucuses",
    { countryId: 1, partyId: 1, disbandedAt: 1 },
    { name: "caucuses_country_party_disbandedAt" },
    log
  );
  await ensureIndex(
    db,
    "caucuses",
    { countryId: 1, partyId: 1, previousSlugs: 1 },
    { name: "caucuses_country_party_previousSlugs" },
    log
  );
  await ensureIndex(
    db,
    "caucuses",
    { countryId: 1, partyId: 1, chairId: 1 },
    { name: "caucuses_country_party_chairId" },
    log
  );

  await ensureIndex(
    db,
    "caucusMemberships",
    { caucusId: 1, status: 1, memberType: 1 },
    { name: "caucusMemberships_caucus_status_memberType" },
    log
  );
  await ensureIndex(
    db,
    "caucusMemberships",
    { memberId: 1, status: 1 },
    { name: "caucusMemberships_member_status" },
    log
  );

  await ensureIndex(
    db,
    "caucusPolicyPositions",
    { caucusId: 1, sortOrder: 1 },
    { name: "caucusPolicyPositions_caucus_sortOrder" },
    log
  );

  log("Caucus chair election indexes:");

  await ensureIndex(
    db,
    "caucusChairElections",
    { caucusId: 1, status: 1 },
    { name: "caucusChairElections_caucus_status" },
    log
  );
  await ensureIndex(
    db,
    "caucusChairElections",
    { caucusId: 1 },
    {
      name: "caucusChairElections_one_active_per_caucus",
      unique: true,
      partialFilterExpression: { status: "voting" },
    },
    log
  );
  await ensureIndex(
    db,
    "caucusChairElections",
    { status: 1, endTurn: 1 },
    { name: "caucusChairElections_status_endTurn" },
    log
  );
  await ensureIndex(
    db,
    "caucusChairCandidates",
    { electionId: 1, characterId: 1 },
    { name: "caucusChairCandidates_election_character", unique: true },
    log
  );
  await ensureIndex(
    db,
    "caucusChairCandidates",
    { electionId: 1, status: 1 },
    { name: "caucusChairCandidates_election_status" },
    log
  );
  await ensureIndex(
    db,
    "caucusChairVotes",
    { electionId: 1, voterId: 1 },
    { name: "caucusChairVotes_election_voter", unique: true },
    log
  );
  await ensureIndex(
    db,
    "caucusChairVotes",
    { electionId: 1, candidateId: 1 },
    { name: "caucusChairVotes_election_candidate" },
    log
  );

  log("NPP cross-pressure prediction indexes:");

  // Federal and local bill predictions share the same collection; the separate
  // partial-unique indexes prevent stateBillId rows from colliding under the
  // federal { nppId, billId } uniqueness rule.
  await ensureIndex(
    db,
    "nppVotePredictions",
    { nppId: 1, billId: 1 },
    {
      name: "nppVotePredictions_npp_bill",
      unique: true,
      partialFilterExpression: { billId: { $exists: true } },
    },
    log
  );
  await ensureIndex(
    db,
    "nppVotePredictions",
    { nppId: 1, stateBillId: 1 },
    {
      name: "nppVotePredictions_npp_stateBill",
      unique: true,
      partialFilterExpression: { stateBillId: { $exists: true } },
    },
    log
  );
  await ensureIndex(
    db,
    "nppVotePredictions",
    { billId: 1 },
    { name: "nppVotePredictions_bill" },
    log
  );
  await ensureIndex(
    db,
    "nppVotePredictions",
    { stateBillId: 1 },
    { name: "nppVotePredictions_stateBill" },
    log
  );
  await ensureIndex(
    db,
    "nppVotePredictions",
    { nppId: 1, computedAtTurn: -1, updatedAt: -1 },
    { name: "nppVotePredictions_npp_turn" },
    log
  );
  await ensureIndex(
    db,
    "nppVotePredictions",
    { computedAtTurn: -1 },
    { name: "nppVotePredictions_computedAtTurn" },
    log
  );

  await ensureIndex(
    db,
    "nppEndorsements",
    { isActive: 1, electionId: 1, createdAt: -1 },
    { name: "nppEndorsements_active_election_createdAt" },
    log
  );
  await ensureIndex(
    db,
    "nppEndorsements",
    { nppId: 1, isActive: 1, createdAt: -1 },
    { name: "nppEndorsements_npp_active_createdAt" },
    log
  );
  await ensureIndex(
    db,
    "nppEndorsements",
    { electionId: 1, candidateId: 1, isActive: 1 },
    { name: "nppEndorsements_election_candidate_active" },
    log
  );

  log("Political capital indexes:");

  await ensureIndex(
    db,
    "politicalCapitalBalances",
    { characterId: 1 },
    { name: "politicalCapitalBalances_characterId", unique: true },
    log
  );
  await ensureIndex(
    db,
    "capitalActionLogs",
    { characterId: 1, turn: -1 },
    { name: "capitalActionLogs_character_turn" },
    log
  );
  await ensureIndex(
    db,
    "capitalActionLogs",
    { nppId: 1, turn: -1 },
    { name: "capitalActionLogs_npp_turn" },
    log
  );
  await ensureIndex(
    db,
    "nppVoteCommitments",
    { nppId: 1, billId: 1 },
    { name: "nppVoteCommitments_npp_bill" },
    log
  );
  await ensureIndex(
    db,
    "nppVoteCommitments",
    { characterId: 1 },
    { name: "nppVoteCommitments_characterId" },
    log
  );

  log("Recruitment slate indexes:");

  await ensureIndex(
    db,
    "recruitmentSlates",
    { countryId: 1, partyId: 1, archivedAt: 1 },
    { name: "recruitmentSlates_country_party_archivedAt" },
    log
  );
  await ensureIndex(
    db,
    "recruitmentSlates",
    { countryId: 1, partyId: 1, electionId: 1 },
    { name: "recruitmentSlates_party_election", unique: true },
    log
  );
  await ensureIndex(
    db,
    "recruitmentSlates",
    { countryId: 1, partyId: 1, state: 1 },
    { name: "recruitmentSlates_country_party_state" },
    log
  );
  await ensureIndex(
    db,
    "recruitmentSlates",
    { countryId: 1, partyId: 1, state: 1, electionType: 1, updatedAt: -1 },
    { name: "recruitmentSlates_template_lookup" },
    log
  );
  await ensureIndex(
    db,
    "slateCandidates",
    { slateId: 1 },
    { name: "slateCandidates_slateId" },
    log
  );
  await ensureIndex(
    db,
    "slateCandidates",
    { slateId: 1, candidateId: 1 },
    { name: "slateCandidates_slate_candidate", unique: true },
    log
  );
  await ensureIndex(
    db,
    "slateCandidates",
    { electionId: 1, status: 1 },
    { name: "slateCandidates_election_status" },
    log
  );
  await ensureIndex(
    db,
    "slateCandidates",
    { candidateId: 1 },
    { name: "slateCandidates_candidateId" },
    log
  );
  await ensureIndex(
    db,
    "slateCandidates",
    { countryId: 1, partyId: 1, updatedAt: -1 },
    { name: "slateCandidates_country_party_updatedAt" },
    log
  );
  await ensureIndex(
    db,
    "slateCandidates",
    { status: 1, candidateType: 1 },
    { name: "slateCandidates_status_type" },
    log
  );

  log("Treasury transaction indexes:");

  await ensureIndex(
    db,
    "treasuryTransactions",
    { countryId: 1, partyId: 1, createdAt: -1 },
    { name: "treasuryTransactions_country_party_createdAt" },
    log
  );
  await ensureIndex(
    db,
    "treasuryTransactions",
    { holderType: 1, holderId: 1, createdAt: -1 },
    { name: "treasuryTransactions_holder_createdAt" },
    log
  );

  log("Party / NPP rework indexes ensured");
}
