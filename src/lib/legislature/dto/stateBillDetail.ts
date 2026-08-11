import type { VoteByParty } from "@/lib/congress/billVoting";
import type { BillProvisionDisplay } from "@/lib/legislature/dto/stateLegislature";

export interface StateBillDetail {
  id: string;
  stateId: string;
  countryId: string;
  title: string;
  summary: string;
  adminProposed?: boolean;
  sponsorId?: string | null;
  sponsorSequentialId?: number;
  sponsorName: string;
  sponsorParty?: string;
  sponsorPartyColor?: string;
  status: string;
  votesFor: number;
  votesAgainst: number;
  votesAbstain: number;
  /** Total seats in the state chamber (for the vote-seating hero). 0 if unknown. */
  eligibleSeats: number;
  legislationTypeName: string | null;
  proposedAt: string;
  votingEndsAt?: string;
  votingEndsOnTurn?: number;
  governorActionDeadline?: string;
  governorActionDeadlineOnTurn?: number;
  overrideVotingEndsAt?: string;
  overrideVotingEndsOnTurn?: number;
  myVote: "for" | "against" | "abstain" | null;
  myOverrideVote: "for" | "against" | null;
  provisions: BillProvisionDisplay[];
  voteByParty: VoteByParty[];
  voteByPartyOverride: VoteByParty[];
  overrideVotesFor: number;
  overrideVotesAgainst: number;
  canVote: boolean;
  canGovernorAction: boolean;
  /** Public message attached to a veto; only set when status indicates vetoed. */
  vetoMessage?: string;
}
