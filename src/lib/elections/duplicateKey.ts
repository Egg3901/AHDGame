interface DuplicateKeyErrorLike extends Error {
  code?: number;
  keyPattern?: Record<string, unknown>;
}

export function isDuplicateKeyError(error: unknown): error is DuplicateKeyErrorLike {
  if (typeof error !== "object" || error === null) return false;
  const candidate = error as DuplicateKeyErrorLike & {
    writeErrors?: { code?: number }[];
  };
  if (candidate.code === 11000) return true;
  if (candidate.writeErrors?.some((writeError) => writeError.code === 11000)) return true;
  return typeof candidate.message === "string" && candidate.message.includes("E11000");
}

/**
 * Race-tolerant insert for create-missing election sweeps. A unique voting
 * index is the real guard; this keeps a concurrent turn from 500'ing the
 * phase when the read-then-insert window still overlaps.
 */
export async function insertManyIgnoringDuplicateKey<T>(
  collection: {
    insertMany: (docs: T[], options?: { ordered?: boolean }) => Promise<{ insertedCount: number }>;
  },
  docs: T[]
): Promise<number> {
  if (docs.length === 0) return 0;
  try {
    const result = await collection.insertMany(docs, { ordered: false });
    return result.insertedCount;
  } catch (error) {
    if (!isDuplicateKeyError(error)) throw error;
    const bulk = error as {
      insertedCount?: number;
      result?: { insertedCount?: number };
    };
    return bulk.insertedCount ?? bulk.result?.insertedCount ?? 0;
  }
}

function keyPatternIncludes(error: DuplicateKeyErrorLike, field: string): boolean {
  return error.keyPattern?.[field] === 1;
}

function messageMentions(error: DuplicateKeyErrorLike, token: string): boolean {
  return error.message.includes(token);
}

export function isActiveElectionCandidateDuplicateKey(error: unknown): boolean {
  return (
    isDuplicateKeyError(error) &&
    (keyPatternIncludes(error, "characterId") ||
      messageMentions(error, "unique_active_election_candidate_per_character"))
  );
}

export function isActiveStatePartyCandidateDuplicateKey(error: unknown): boolean {
  return (
    isDuplicateKeyError(error) &&
    (keyPatternIncludes(error, "stateId") ||
      messageMentions(error, "unique_active_state_party_candidate_per_member"))
  );
}

export function isActiveNationalPartyCandidateDuplicateKey(error: unknown): boolean {
  return (
    isDuplicateKeyError(error) &&
    (keyPatternIncludes(error, "partyId") ||
      messageMentions(error, "unique_active_national_party_candidate_per_member"))
  );
}

export function isActiveNationalCommitteeCandidateDuplicateKey(error: unknown): boolean {
  return (
    isDuplicateKeyError(error) &&
    (keyPatternIncludes(error, "partyId") ||
      messageMentions(error, "unique_active_national_committee_candidate_per_member"))
  );
}

export function isActivePlayerEndorsementDuplicateKey(error: unknown): boolean {
  return (
    isDuplicateKeyError(error) &&
    ((keyPatternIncludes(error, "characterId") && keyPatternIncludes(error, "electionId")) ||
      messageMentions(error, "unique_active_player_endorsement_per_election"))
  );
}

export function isPendingOrganizationLeadershipElectionDuplicateKey(error: unknown): boolean {
  return (
    isDuplicateKeyError(error) &&
    (keyPatternIncludes(error, "organizationId") ||
      messageMentions(error, "unique_pending_org_leadership_election_per_org"))
  );
}

export function isPendingOrganizationMembershipProposalDuplicateKey(error: unknown): boolean {
  return (
    isDuplicateKeyError(error) &&
    ((keyPatternIncludes(error, "organizationId") &&
      keyPatternIncludes(error, "proposingCountryId")) ||
      messageMentions(error, "unique_pending_org_membership_proposal_per_country"))
  );
}

export function isActiveCabinetNominationDuplicateKey(error: unknown): boolean {
  return (
    isDuplicateKeyError(error) &&
    ((keyPatternIncludes(error, "countryId") && keyPatternIncludes(error, "positionId")) ||
      messageMentions(error, "unique_active_cabinet_nomination_per_position"))
  );
}

export function isPendingShareOfferDuplicateKey(error: unknown): boolean {
  return (
    isDuplicateKeyError(error) &&
    ((keyPatternIncludes(error, "listingId") && keyPatternIncludes(error, "buyerCharacterId")) ||
      messageMentions(error, "unique_pending_share_offer_per_buyer_listing"))
  );
}

export function isNationalPartyVoteDuplicateKey(error: unknown): boolean {
  return (
    isDuplicateKeyError(error) &&
    ((keyPatternIncludes(error, "electionId") && keyPatternIncludes(error, "voterId")) ||
      messageMentions(error, "unique_national_party_vote_per_voter"))
  );
}

export function isStatePartyVoteDuplicateKey(error: unknown): boolean {
  return (
    isDuplicateKeyError(error) &&
    ((keyPatternIncludes(error, "electionId") && keyPatternIncludes(error, "voterId")) ||
      messageMentions(error, "unique_state_party_vote_per_voter"))
  );
}

export function isNationalCommitteeVoteDuplicateKey(error: unknown): boolean {
  return (
    isDuplicateKeyError(error) &&
    ((keyPatternIncludes(error, "electionId") && keyPatternIncludes(error, "voterId")) ||
      messageMentions(error, "unique_national_committee_vote_per_voter"))
  );
}

export function isCorporationCeoVoteDuplicateKey(error: unknown): boolean {
  return (
    isDuplicateKeyError(error) &&
    ((keyPatternIncludes(error, "corporationId") &&
      keyPatternIncludes(error, "voterCharacterId")) ||
      messageMentions(error, "unique_corporation_ceo_vote_per_shareholder"))
  );
}

export function isUnionLeaderVoteDuplicateKey(error: unknown): boolean {
  return (
    isDuplicateKeyError(error) &&
    ((keyPatternIncludes(error, "unionId") && keyPatternIncludes(error, "voterCharacterId")) ||
      messageMentions(error, "unique_union_leader_vote_per_organizer"))
  );
}
