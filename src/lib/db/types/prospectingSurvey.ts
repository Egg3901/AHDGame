import type { ObjectId } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { ExtractableResource } from "@/lib/constants/commodities";

/**
 * A geological survey ("prospect") launched against one (state, resource) pair.
 *
 * An initiator (extraction corporation, national government, or state
 * government) pays a cost up front; the survey resolves PROSPECT_DURATION_TURNS
 * later. On success it grows the state's per-resource extraction capacity
 * (a $inc on stateResourceCapacity.resources.<r>, same write pattern as
 * rdInnovation), on failure it produces nothing but a notification.
 *
 * Docs are NEVER auto-created for a state that has no capacity doc / no
 * capacity for the resource — a survey targets an already-enabled deposit and
 * expands it (matches the rdInnovation "never auto-insert cap docs" rule).
 */
export interface ProspectingSurvey {
  _id: ObjectId;
  initiatorType: "corporation" | "national_government" | "state_government";
  /** Set for corporation surveys. */
  corporationId?: ObjectId;
  /** The user who launched the survey (recipient of the resolution notification). */
  initiatorUserId?: string;
  countryId: CountryId;
  stateId: string;
  resource: ExtractableResource;
  startedTurn: number;
  /** startedTurn + PROSPECT_DURATION_TURNS. Resolves on the first turn >= this. */
  completesTurn: number;
  /** What was paid, in anchor units (post-escalation). */
  costAnchor: number;
  /** rdScore snapshot at launch (corp surveys) — drives the success roll. */
  rdScoreAtStart?: number;
  status: "active" | "succeeded" | "failed";
  /** Capacity units added on success. */
  capacityGained?: number;
  resolvedTurn?: number;
  createdAt: Date;
  updatedAt: Date;
}
