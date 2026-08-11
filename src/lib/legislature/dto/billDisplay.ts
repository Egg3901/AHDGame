import type { BillChamber, BillStatus } from "@/lib/db/types";
import type { CountryId } from "@/lib/constants/countries";
import type { BillProposalAutoFailWarning } from "@/lib/legislature/billAutoFailWarning";

export interface BillDisplay {
  id: string;
  title: string;
  summary: string;
  adminProposed?: boolean;
  /** Country this bill belongs to — drives unicameral-vs-bicameral timeline shape. */
  countryId?: CountryId;
  originChamber: BillChamber;
  currentChamber: BillChamber;
  sponsorId: string | null;
  /** Prefer for `/character/{id}` links when present. */
  sponsorSequentialId?: number;
  sponsorName: string;
  sponsorParty: string;
  sponsorPartyName: string;
  sponsorPartyColor: string;
  status: BillStatus;
  // Origin chamber tally
  votesFor: number;
  votesAgainst: number;
  votesAbstain: number;
  totalVotes: number;
  // Other chamber tally
  otherChamberVotesFor: number;
  otherChamberVotesAgainst: number;
  otherChamberVotesAbstain: number;
  category: string;
  legislationTypeId: string | null;
  legislationTypeName: string | null;
  effectDirection: number | null;
  /** Human-readable policy direction for legacy single provision */
  directionLabel: "Left" | "Center" | "Right" | null;
  /** Formatted position (econ/social) when available; use instead of directionLabel when present */
  positionLabel: string | null;
  /** What the legacy provision changes (e.g. "Education spending") */
  effectTargetLabel: string | null;
  /** When bill has multiple provisions */
  provisions?: {
    legislationTypeId: string;
    legislationTypeName: string;
    effectDirection: number;
    directionLabel: "Left" | "Center" | "Right";
    /** Formatted economic/social position when available */
    positionLabel?: string;
    effectTargetLabel?: string;
    economic?: number;
    social?: number;
  }[];
  proposedAt: string;
  votingStartedAt: string | null;
  votingEndsAt: string | null;
  /** Game-clock turn on which voting closes (durable against drift). */
  votingEndsOnTurn: number | null;
  otherChamberVotingEndsAt: string | null;
  otherChamberVotingEndsOnTurn: number | null;
  passedAt: string | null;
  enactedAt: string | null;
  /** The calling user's current-chamber vote */
  myVote: "for" | "against" | "abstain" | null;
  myOtherChamberVote: "for" | "against" | "abstain" | null;
  /** Whether the user can vote on this bill in the origin chamber */
  canVoteOrigin: boolean;
  /** Whether the user can vote on this bill in the other chamber */
  canVoteOther: boolean;
  requiresExecutiveAction: boolean;
  /** When the bill failed (for timeline display) */
  failedAt: string | null;
}

export interface BillsResponse {
  bills: BillDisplay[];
  total: number;
  canPropose: boolean;
  /** True when current user can propose only because they are an admin (Admin override) */
  adminOverride?: boolean;
  /** The chamber the user is a member of (house/senate) - determines which bills they can propose */
  myChamber?: "house" | "senate" | null;
  /** True when the user already has a non-terminal bill in progress */
  hasActiveBill?: boolean;
  /** If the user cannot propose, why? */
  activeBillMessage?: string;
  /** Number of actions required to propose under the current rules */
  actionCost?: number;
  /** Provisions already claimed by active bills — frontend should disable these options */
  blockedProvisions?: { legislationTypeId: string; policyOptionId: string }[];
  /** Chamber-specific warnings when a proposal would likely die at a lower-chamber election resolution */
  proposalWarnings?: Record<string, BillProposalAutoFailWarning | null>;
  /** Optional warning that the new proposal will auto-fail against current law */
  autoFailWarning?: BillProposalAutoFailWarning | null;
}
