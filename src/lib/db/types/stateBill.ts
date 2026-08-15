import type { ObjectId } from "mongodb";
import type { CorporationType } from "../../constants/corporations";
import type { CountryId } from "../../constants/countries";
import type { BillVoteSnapshot } from "./voteSnapshot";

export type StateBillStatus =
  | "proposed"
  | "active"
  | "passed"
  | "signed"
  | "vetoed"
  | "veto_override"
  | "override_failed"
  | "enacted"
  | "failed"
  /**
   * Transient lock statuses used by processStateBillTimers to atomically claim
   * bills before resolving them, preventing TOCTOU races under concurrent
   * turn processing. Should never be visible to players or persist beyond the
   * turn in which they were set.
   */
  | "vote_closing"
  | "override_closing";

export interface StateBillPolicyProvision {
  type?: "policy"; // optional for backwards compat with existing docs
  legislationTypeId: string;
  policyOptionId?: string;
  effectDirection: number;
  economic?: number;
  social?: number;
  /** Tax-slider laws: the slider-chosen rate. */
  proposedRate?: number;
  policyOptionNameSnapshot?: string;
  currentPolicyOptionNameSnapshot?: string;
}

export interface StateBillSubsidyProvision {
  type: "subsidy";
  scopeType: "sector" | "economy_wide";
  targetSectorType?: CorporationType;
  targetStrategyId?: string;
  domesticOnly: boolean;
}

export interface StateBillEndSubsidyProvision {
  type: "end_subsidy";
  scopeType: "sector" | "economy_wide";
  targetSectorType?: CorporationType;
  targetStrategyId?: string;
}

export type StateBillProvision =
  StateBillPolicyProvision | StateBillSubsidyProvision | StateBillEndSubsidyProvision;

export interface StateBill {
  _id: ObjectId;
  stateId: string;
  /** Country the state belongs to — required for country-isolation queries. */
  countryId?: CountryId;
  title: string;
  summary: string;
  sponsorId: ObjectId | null;
  sponsorName: string;
  sponsorParty?: string;
  /** True when the bill was created via admin override rather than by a seated sponsor. */
  adminProposed?: boolean;
  isNPP?: boolean;
  nppId?: ObjectId;
  status: StateBillStatus;

  // Voting
  votesFor: number;
  votesAgainst: number;
  votesAbstain: number;
  votes: Record<string, "for" | "against" | "abstain">;
  /** Frozen origin-chamber result, set when the bill leaves `active` (#0982). */
  voteSnapshot?: BillVoteSnapshot;
  /** Frozen veto-override result, set when the bill leaves `veto_override` (#0982). */
  overrideVoteSnapshot?: BillVoteSnapshot;

  // Effects
  category?: string;
  legislationTypeId?: string;
  effectDirection?: number;
  provisions?: StateBillProvision[];

  /**
   * Set when enactment was blocked by the state budget hard gate (audit S6):
   * the state could not fund the bill, so it transitioned to "failed" instead
   * of enacting.
   */
  budgetRejection?: {
    error: "INSUFFICIENT_FUNDS" | "DEBT_CEILING_EXCEEDED";
    costAmount: number;
    shortfall?: number;
    rejectedAt: Date;
  };

  // Timestamps
  proposedAt: Date;
  votingStartedAt?: Date;
  votingEndsAt?: Date;
  /** Game-clock turn on which voting closes. Server resolution uses this. */
  votingEndsOnTurn?: number;
  passedAt?: Date;
  sentToGovernorAt?: Date;
  governorActionDeadline?: Date;
  /** Game-clock turn on which the governor's action window closes. Server resolution uses this. */
  governorActionDeadlineOnTurn?: number;
  governorAction?: "signed" | "vetoed";

  // Veto override
  overrideVotingStartedAt?: Date;
  overrideVotingEndsAt?: Date;
  /** Game-clock turn on which the veto-override voting closes. Server resolution uses this. */
  overrideVotingEndsOnTurn?: number;
  overrideVotesFor?: number;
  overrideVotesAgainst?: number;
  overrideVotes?: Record<string, "for" | "against">;

  enactedAt?: Date;
  failedAt?: Date;
  /** National influence spent on provisions — refunded if bill passes */
  proposalNpiCost?: number;
  /** Action points spent to propose — refunded if bill passes */
  proposalActionCost?: number;

  // Veto messaging — set when the governor vetoes via the governor-action endpoint.
  /** Public message attached to a veto; 10-280 chars. */
  vetoMessage?: string;
  vetoedByCharacterId?: ObjectId;
  vetoedAtTurn?: number;

  // Governor-queued bills — set when a bill was introduced via the legislation queue.
  /** NPP that introduced this bill via the governor's legislation queue. */
  sponsorNppId?: ObjectId;
  /** When set, this bill originated from the named governor's queue. */
  proposedByGovernor?: { characterId: ObjectId; name: string };

  createdAt: Date;
  updatedAt: Date;
}
