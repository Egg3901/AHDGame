// src/lib/db/types/statePolicy.ts
import type { ObjectId } from "mongodb";

/**
 * Discriminated origin of a state-policy effect.
 * Replaces the overloaded `enactedByBillId` field so executive orders can
 * also drive a StatePolicy row.
 */
export type EnactedByKind = "bill" | "order" | "expiry";

export interface EnactedBy {
  kind: EnactedByKind;
  id: ObjectId;
}

export interface StatePolicy {
  _id?: ObjectId;
  /**
   * Distinguishes country-scope docs (national pseudo-stateIds like "federal",
   * "uk_national", "jp_national") from per-region docs. Required on new writes;
   * optional on reads because pre-migration docs may lack it (see
   * scripts/migrations/backfillStatePolicyScope.ts).
   */
  scope?: "national" | "state";
  stateId: string; // "CA", "TX", etc. (or "federal")
  legislationTypeId: string;
  policyOptionId: string;
  policyOptionIndex: number; // ladder index (0-6 legacy, maps to -3..+3; 0-4 new-generation political laws)
  enactedAt: Date;
  enactedTurn: number; // Game turn when enacted (for time-based effect decay)
  /**
   * @deprecated Legacy field; new writes also set `enactedBy`. Will be removed
   * after `scripts/migrations/renameStatePolicyEnactedBy.ts` has backfilled.
   */
  enactedByBillId?: ObjectId;
  /** Source of this policy row — bill, executive order, or expiry-restore. */
  enactedBy?: EnactedBy;
  economic: number; // -3 to +3
  social: number; // -3 to +3
  effectDirection: number; // -1, 0, +1
}

export interface StateMetricBaseline {
  _id: string; // stateId
  baselines: Record<string, Record<string, number>>; // category.metric -> baseline (40-60)
}

export interface PolicyReaction {
  _id?: ObjectId;
  stateId: string;
  legislationTypeId: string;
  policyOptionId: string;
  groupReactions: Record<string, number>;
  initialReactions: Record<string, number>;
  enactedAt: Date;
  enactedTurn: number;
}

export interface VoteImpact {
  _id?: ObjectId;
  characterId: ObjectId;
  billId: ObjectId;
  chamber: "house" | "senate" | "state_senate";
  vote: "for" | "against" | "abstain";
  stateId?: string;
  /** Per-archetype approval changes from this vote */
  archetypeImpacts?: Record<string, number>;
  recordedAt: Date;
  recordedTurn: number;
}
