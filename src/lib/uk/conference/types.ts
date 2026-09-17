import type { ObjectId } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { RulesetAmendmentPatch } from "../leadership/rules";

/** Lifecycle of one annual party conference. */
export type ConferenceStatus = "scheduled" | "open" | "completed" | "expired";

export type ConferenceProposalStatus = "voting" | "ratified" | "rejected";

export type ConferenceMotionStatus = "voting" | "passed" | "failed" | "void";

/** How a conference reached its terminal state. */
export type ConferenceOutcomeKind = "ratified" | "closedWithoutRatification" | "missed";

/**
 * The standing-platform proposal before the conference: pledge catalog ids
 * in the SAME shape as an election manifesto (MANIFESTO_PLEDGE_COUNT valid
 * catalog entries, no dupes), voted by party members and, on ratification,
 * written to the party's standing-platform row.
 */
export interface ConferencePlatformProposal {
  pledgeIds: string[];
  proposedByCharacterId: ObjectId;
  proposedByName: string;
  proposedAtTurn: number;
  /** Aye = ratify the platform. */
  votesFor: number;
  /** Nay = reject the platform. */
  votesAgainst: number;
  votes: Record<string, "aye" | "nay">;
  status: ConferenceProposalStatus;
  resolvedAtTurn: number | null;
}

/**
 * Committee business at conference: a leadership-ruleset amendment carried
 * under the #861 committee authority model (committee proposes, committee
 * votes, safe bounds + cooldown enforced on apply).
 */
export interface ConferenceRulesMotion {
  motionId: string;
  patch: RulesetAmendmentPatch;
  proposedByCharacterId: ObjectId;
  proposedByName: string;
  createdAtTurn: number;
  votesFor: number;
  votesAgainst: number;
  votes: Record<string, "aye" | "nay">;
  status: ConferenceMotionStatus;
  /** Why a motion voided instead of applying (e.g. cooldown active). */
  voidReason: string | null;
  resolvedAtTurn: number | null;
}

export type ConferenceHistoryKind =
  | "scheduled"
  | "opened"
  | "platformProposed"
  | "platformRatified"
  | "platformRejected"
  | "motionProposed"
  | "motionPassed"
  | "motionFailed"
  | "motionVoided"
  | "completed"
  | "expired"
  | "payoffApplied";

export interface ConferenceHistoryEntry {
  turn: number;
  at: Date;
  kind: ConferenceHistoryKind;
  actorCharacterId?: ObjectId;
  actorName?: string;
  detail: string;
}

/**
 * One annual conference for one UK party. One row per
 * `<countryId>:<partySequentialId>:<conferenceYear>`.
 *
 * The standing platform is ratified HERE, between elections; the leader
 * finalises the election manifesto FROM it at dissolution/election call
 * (see manifestoLifecycle). The two are never the same row: ratifying a
 * platform never writes the manifestos collection.
 */
export interface UKPartyConference {
  _id: string;
  countryId: CountryId;
  partyId: string;
  partyName: string;
  /** 1-based game-calendar year index (turns 1-48 = year 1). */
  conferenceYear: number;
  status: ConferenceStatus;
  /** Turn the conference opens for agenda + voting. */
  opensAtTurn: number;
  /** Turn voting closes and the conference resolves. */
  votingClosesTurn: number;
  openedAtTurn: number | null;
  proposal: ConferencePlatformProposal | null;
  motions: ConferenceRulesMotion[];
  /** True once a platform ratified at this conference. */
  ratified: boolean;
  outcome: ConferenceOutcomeKind | null;
  /** True once the completion payoff was attempted (applied or skipped). */
  payoffDue: boolean;
  payoffAppliedTurn: number | null;
  history: ConferenceHistoryEntry[];
  createdAt: Date;
  updatedAt: Date;
}

/**
 * A party's standing platform: the pledge set its last conference ratified.
 * One row per `<countryId>:<partySequentialId>`, upserted on ratification.
 * The election-manifesto handoff seeds a missing leader draft FROM these
 * ids; the leader's own complete draft always wins.
 */
export interface UKPartyPlatform {
  _id: string;
  countryId: CountryId;
  partyId: string;
  pledgeIds: string[];
  ratifiedConferenceId: string;
  ratifiedYear: number;
  ratifiedAtTurn: number;
  createdAt: Date;
  updatedAt: Date;
}
