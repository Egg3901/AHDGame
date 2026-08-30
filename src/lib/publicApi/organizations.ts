import type { Db } from "mongodb";
import type {
  OrganizationLeadershipElection,
  OrganizationLegislation,
  OrganizationMembershipProposal,
  ProposalVoteRecord,
} from "@/lib/db/types/internationalOrganization";
import {
  loadOrganizationSummaries,
  type OrganizationSummary,
} from "@/lib/internationalOrganizations/service";

function iso(value: Date | null | undefined): string | null {
  return value instanceof Date && !Number.isNaN(value.getTime()) ? value.toISOString() : null;
}

function summarizeVotes(votes: ProposalVoteRecord[]) {
  const totals = { yes: 0, no: 0, abstain: 0 };
  for (const vote of votes) totals[vote.vote] += 1;
  return {
    totals,
    byCountry: votes.map((vote) => ({
      countryId: vote.countryId,
      vote: vote.vote,
      castOnTurn: vote.castOnTurn,
      castAt: iso(vote.castAt),
    })),
  };
}

function serializeMembershipProposal(proposal: OrganizationMembershipProposal) {
  return {
    id: proposal._id.toString(),
    countryId: proposal.proposingCountryId,
    status: proposal.status,
    proposedOnTurn: proposal.proposedOnTurn,
    closesOnTurn: proposal.closesOnTurn,
    resolvedOnTurn: proposal.resolvedOnTurn ?? null,
    orgVoteExempt: proposal.orgVoteExempt ?? false,
    orgApproved: proposal.orgApproved ?? null,
    domesticApproved: proposal.domesticApproved ?? null,
    votes: summarizeVotes(proposal.votes ?? []),
  };
}

function serializeResolution(resolution: OrganizationLegislation) {
  return {
    id: resolution._id.toString(),
    type: resolution.type,
    title: resolution.title,
    description: resolution.description ?? null,
    status: resolution.status,
    parties: resolution.parties ?? [],
    proposingCountryId: resolution.proposingCountryId,
    proposedOnTurn: resolution.proposedOnTurn,
    closesOnTurn: resolution.closesOnTurn,
    enactedOnTurn: resolution.enactedOnTurn ?? null,
    parameters: {
      sanctionsTargetCountryId: resolution.sanctionsTargetCountryId ?? null,
      sanctionsCommodity: resolution.sanctionsCommodity ?? null,
      sanctionsExpiresOnTurn: resolution.sanctionsExpiresOnTurn ?? null,
      aidDonorCountryId: resolution.aidDonorCountryId ?? null,
      aidRecipientCountryId: resolution.aidRecipientCountryId ?? null,
      aidAmount: resolution.aidAmount ?? null,
      duesRateAnnual: resolution.duesRateAnnual ?? null,
      directiveKey: resolution.directiveKey ?? null,
      directiveExpiresOnTurn: resolution.directiveExpiresOnTurn ?? null,
      jointStatementSubjectCountryId: resolution.jointStatementSubjectCountryId ?? null,
      jointStatementStance: resolution.jointStatementStance ?? null,
      jointStatementExpiresOnTurn: resolution.jointStatementExpiresOnTurn ?? null,
      postureValue: resolution.postureValue ?? null,
      agencyKey: resolution.agencyKey ?? null,
      agencyExpiresOnTurn: resolution.agencyExpiresOnTurn ?? null,
      joinConflictTheaterId: resolution.joinConflictTheaterId ?? null,
      joinConflictSide: resolution.joinConflictSide ?? null,
    },
    votes: summarizeVotes(resolution.votes ?? []),
  };
}

function serializeLeadershipElection(election: OrganizationLeadershipElection) {
  return {
    id: election._id.toString(),
    candidateName: election.candidateCharacterName,
    candidateCountryId: election.candidateCountryId,
    status: election.status,
    proposedOnTurn: election.proposedOnTurn,
    closesOnTurn: election.closesOnTurn,
    votes: summarizeVotes(election.votes ?? []),
  };
}

function serializeSummary(summary: OrganizationSummary) {
  const leadership = summary.leadership;
  return {
    id: summary.id,
    name: summary.def.name,
    shortName: summary.def.shortName,
    description: summary.def.description,
    category: summary.def.category,
    logoPath: summary.def.logoPath,
    isCustom: summary.def.isCustom ?? false,
    foundedYear: summary.def.foundedYear ?? null,
    dissolvedYear: summary.def.dissolvedYear ?? null,
    leadershipOffice: {
      title: summary.def.leadership.title,
      termTurns: summary.def.leadership.termTurns,
    },
    leadership: leadership
      ? {
          holderName: leadership.holderCharacterName,
          holderCountryId: leadership.holderCountryId,
          electedOnTurn: leadership.electedOnTurn,
          termEndsOnTurn: leadership.termEndsOnTurn,
        }
      : null,
    memberCount: summary.members.length,
    votingMemberCount: summary.members.filter((member) => member.hasVote).length,
    members: summary.members.map((member) => ({
      countryId: member.countryId,
      countryName: member.countryName,
      flagEmoji: member.flagEmoji,
      status: member.status,
      joinedTurn: member.joinedTurn,
      hasVote: member.hasVote,
      isCountry: member.isCountry,
    })),
    activity: {
      pendingMemberships: summary.pendingMembershipProposals.length,
      pendingResolutions: summary.pendingLegislation.length,
      activeResolutions: summary.activeLegislation.length,
      pendingLeadershipElections: summary.pendingLeadershipElections.length,
      pendingWithdrawals: summary.pendingWithdrawalMeasures.length,
    },
  };
}

export async function queryOrganizations(db: Db) {
  const summaries = await loadOrganizationSummaries(db);
  return {
    found: summaries.length > 0,
    count: summaries.length,
    organizations: summaries.map(serializeSummary),
  };
}

export async function queryOrganization(db: Db, id: string) {
  const summary = (await loadOrganizationSummaries(db)).find(
    (organization) => organization.id.toLowerCase() === id.toLowerCase()
  );
  if (!summary) return null;

  return {
    ...serializeSummary(summary),
    charter: summary.def.charter,
    membershipProposals: summary.pendingMembershipProposals.map(serializeMembershipProposal),
    resolutions: {
      pending: summary.pendingLegislation.map(serializeResolution),
      active: summary.activeLegislation.map(serializeResolution),
    },
    leadershipElections: summary.pendingLeadershipElections.map(serializeLeadershipElection),
    pendingWithdrawals: summary.pendingWithdrawalMeasures.map((measure) => ({
      billId: measure.billId.toString(),
      action: measure.targetType,
      countryId: measure.targetCountryId,
      resolutionId: measure.organizationLegislationId?.toString() ?? null,
      resolutionTitle: measure.organizationLegislationTitle ?? null,
    })),
  };
}
