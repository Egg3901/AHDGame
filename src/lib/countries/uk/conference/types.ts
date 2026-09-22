import type { ObjectId } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { RulesetAmendmentPatch } from "@/lib/uk/leadership/rules";

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
  /**
   * Crash-recovery receipts (ticket #862 follow-up). Standalone Mongo has
   * no multi-document transactions, so resolution and payoff are claim +
   * reconcile protocols, never pretended atomics:
   *
   * - `status === "completed" && outcome === null` is the durable recovery
   *   state: the open->completed claim won but the fill write never landed.
   *   Votes are frozen (agenda writes require status open) and any caller
   *   may resume the fill; the fill itself is guarded by outcome-null so
   *   exactly one caller wins it.
   * - After the fill, platform + leadership side effects reconcile against
   *   the receipts below; `appliedMotionIds` / `platformAppliedTurn` make
   *   replays skip completed effects instead of double-applying them.
   * - A race-path void (`void: concurrent leadership-rules amendment won
   *   the cooldown race`) is receipt-pending, not terminal: the winning
   *   applier may have created the receipt after the voiding pass's last
   *   confirmation read and crashed before marking. The row stays heal-owed
   *   until a revisit adopts the receipt (motion back to passed) or confirms
   *   the void terminal (`... (confirmed: no effect applied)`), so a void
   *   label never durably covers a completed effect and retries terminate.
   * - Payoff intent (`payoffCohesionPs`, `payoffApprovalGroups`) is fixed at
   *   claim time so resumes replay the SAME intent instead of recomputing
   *   it from drifted state. `payoffSettledTurn` is the driver gate: payoff
   *   work is owed while it is null.
   *
   * All fields are optional so rows written before this change (and
   * hand-built rows) read as "no receipts yet". History stays audit-only
   * and is never a receipt.
   */
  /** Motion ids whose leadership-ruleset side effect completed. */
  appliedMotionIds?: string[];
  /** Turn the standing-platform upsert was confirmed durable (null = owed). */
  platformAppliedTurn?: number | null;
  /** Payoff intent: cohesion grant fixed at claim from the claim-time party. */
  payoffCohesionPs?: number | null;
  /**
   * Authoritative electorate snapshot (ticket #862 follow-up). Standalone
   * Mongo has no cross-collection atomics, so the party/member rows read at
   * vote time cannot be rechecked inside the single-document conference
   * write: a join or removal landing between the read and the write would
   * otherwise seat an invalid ballot or silently move the quorum denominator.
   *
   * Instead the conference carries its own roll, frozen once and never
   * rewritten afterwards:
   *
   * - `eligibleMemberIds`: character ids that may vote on the platform
   *   (player members of the party at freeze time).
   * - `eligibleCommitteeIds`: committee voter-set ids that may vote on
   *   leadership-rules motions at freeze time.
   *
   * Freeze point: the first agenda or resolution touch after the row opens
   * (proposal, vote, or resolve wins a single-winner guarded write; losers
   * re-read the winner's roll). Reads never freeze.
   *
   * Frozen semantics, explicit:
   *
   * - Casting or changing a vote requires roll membership (enforced in the
   *   atomic write filter) AND live membership (pre-check). A member who
   *   joins after the freeze waits for next year's conference; a member who
   *   leaves can no longer cast or change votes.
   * - Ballots already cast stand: leaving never purges a recorded vote, and
   *   a deferred write from a ballot cast while eligible still lands (the
   *   roll is immutable, so the write filter still matches).
   * - Quorum denominators are the frozen roll sizes, so joins cannot inflate
   *   and removals cannot shrink the bar mid-conference.
   * - Proposing stays live-gated (leader/committee at propose time): it
   *   moves no quorum math.
   *
   * Both fields are optional so rows written before this change read as
   * "not frozen yet" and freeze at their first post-change touch. A
   * completed legacy row that resolves without another agenda touch freezes
   * during the fill; only a freeze that cannot persist (no durable row to
   * stamp) falls back to live counts for that one decision.
   */
  eligibleMemberIds?: string[] | null;
  /** Committee roll for motion votes; frozen together with eligibleMemberIds. */
  eligibleCommitteeIds?: string[] | null;
  /** Turn the cohesion credit reconciled (applied or deterministically skipped). */
  payoffCohesionAppliedTurn?: number | null;
  /** Payoff intent: approval groups fixed at claim (empty when gated off). */
  payoffApprovalGroups?: string[];
  /** Turn every payoff side effect verified durable. Null = payoff owed. */
  payoffSettledTurn?: number | null;
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
