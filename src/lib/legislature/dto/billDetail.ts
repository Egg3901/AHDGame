import type { CountryId } from "@/lib/constants/countries";
import type { BillWhipPanelData } from "@/lib/congress/billWhipPanelData";
import type { ProvisionDisplay } from "@/lib/legislature/provisionEnrichment";

export interface BillDetail {
  id: string;
  countryId?: CountryId;
  /** Plain-language passage requirement (two-thirds for nat/priv in free legislatures). */
  passRule?: { rule: "majority" | "twoThirds"; label: string };
  title: string;
  summary: string;
  adminProposed?: boolean;
  fullText: string | null;
  stateId: string | null;
  originChamber: string;
  currentChamber: string;
  sponsorId: string | null;
  sponsorSequentialId?: number;
  sponsorName: string;
  sponsorParty: string;
  sponsorPartyName: string;
  sponsorPartyColor: string;
  coSponsors: { characterId: string; sequentialId?: number; characterName: string }[];
  status: string;
  category: string;
  legislationTypeId: string | null;
  legislationTypeName: string | null;
  effectDirection: number | null;
  directionLabel: "Left" | "Center" | "Right" | null;
  positionLabel?: string | null;
  effectTargetLabel: string | null;
  provisions?: ProvisionDisplay[];
  votesFor: number;
  votesAgainst: number;
  votesAbstain: number;
  totalVotes: number;
  otherChamberVotesFor: number;
  otherChamberVotesAgainst: number;
  otherChamberVotesAbstain: number;
  myVote: "for" | "against" | "abstain" | null;
  myOtherChamberVote: "for" | "against" | "abstain" | null;
  myWhippedFrom: string | null;
  myOtherChamberWhippedFrom: string | null;
  myOverrideWhippedFrom: string | null;
  canVoteOrigin: boolean;
  canVoteOther: boolean;
  canCosponsor: boolean;
  canUncosponsor: boolean;
  canWithdraw: boolean;
  canPresidentialAction: boolean;
  requiresExecutiveAction: boolean;
  proposedAt: string;
  votingStartedAt: string | null;
  votingEndsAt: string | null;
  votingEndsOnTurn: number | null;
  passedOriginAt: string | null;
  sentToOtherChamberAt: string | null;
  otherChamberVotingStartedAt: string | null;
  otherChamberVotingEndsAt: string | null;
  otherChamberVotingEndsOnTurn: number | null;
  passedOtherChamberAt: string | null;
  sentToPresidentAt: string | null;
  presidentActionDeadline: string | null;
  presidentActionDeadlineOnTurn: number | null;
  presidentAction: string | null;
  vetoMessage: string | null;
  enactedAt: string | null;
  failedAt: string | null;
  vetoOverrideVotesFor: number;
  vetoOverrideVotesAgainst: number;
  /**
   * Per-chamber seat-weighted override tallies (US bicameral only; null otherwise).
   * A veto override needs 2/3 of each chamber's SEATS, so the UI renders these
   * against the chamber's total seats rather than the combined vote aggregate.
   */
  overrideHouseFor: number | null;
  overrideHouseSeats: number | null;
  overrideSenateFor: number | null;
  overrideSenateSeats: number | null;
  overrideVotingEndsAt: string | null;
  overrideVotingEndsOnTurn: number | null;
  overrideEnactedAt: string | null;
  overrideFailedAt: string | null;
  myOverrideVote: "for" | "against" | null;
  canVetoOverride: boolean;
  canFilibuster: boolean;
  filibusterInvocations?: {
    characterId: string;
    sequentialId?: number;
    characterName: string;
    invokedAt: string;
  }[];
  voteByPartyOrigin?: VoteByParty[];
  voteByPartyOther?: VoteByParty[];
  whipPanel: BillWhipPanelData | null;
  /**
   * Read-only whip summary for every party seated in the origin chamber.
   * `direction` is the party's national whip ("for"/"against") or null = free vote.
   */
  whipCounts?: BillWhipCount[];
}

export interface BillWhipCount {
  partyId: string;
  partyName: string;
  partyColor: string;
  direction: "for" | "against" | null;
}

export interface VoteByParty {
  party: string;
  partyName: string;
  partyColor: string;
  for: number;
  against: number;
  abstain: number;
  total: number;
}
