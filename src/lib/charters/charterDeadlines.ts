/**
 * Phase 6 D4 — charter expiry / founder-replacement deadline math.
 *
 * Plan rule: `expiresAt = max(createdAt + 14 turns, createdAt + 72 IRL hours)`.
 * Same rule applies to the founder-replacement timer. The intent is to
 * preserve the cadence-blind 14-turn semantic but add an IRL minimum so
 * fast-cadence lobbies don't unfairly time out a draft.
 *
 * Phase 6 implements this with a fixed `MS_PER_TURN` lookup at deadline-
 * computation time. The turn cadence may change mid-draft; `expireCharters`
 * recomputes the deadline once per turn so cadence changes are honored.
 *
 * See plan §"Phase 6 — Decisions Recorded During Execution" D4.
 */

import { MS_PER_TURN } from "@/lib/constants/turnTime";

/** Turns until a draft / founder-replacement deadline fires. */
export const CHARTER_DEADLINE_TURNS = 14;

/** IRL-hour minimum floor for the deadline (Phase 6 D4). */
export const CHARTER_DEADLINE_MIN_IRL_HOURS = 72;

/**
 * Compute the deadline for a charter draft / founder-replacement timer.
 *
 * Returns `max(createdAt + 14 turns, createdAt + 72 hours)` as a `Date`.
 * Pure — caller passes a Date for the start point so this can be unit-
 * tested without time mocking.
 */
export function computeCharterDeadline(start: Date): Date {
  const turnMs = CHARTER_DEADLINE_TURNS * MS_PER_TURN;
  const irlMs = CHARTER_DEADLINE_MIN_IRL_HOURS * 60 * 60 * 1000;
  const deltaMs = Math.max(turnMs, irlMs);
  return new Date(start.getTime() + deltaMs);
}

/**
 * Deadline expressed in turns — the same `max(14 turns, 72 IRL hours)` rule as
 * {@link computeCharterDeadline}, converted to a turn count at the current
 * cadence (= 72 at the standard 1-turn-per-hour cadence). Turn-based resolution
 * freezes on pause and never drifts against the wall clock.
 */
export function computeCharterDeadlineTurns(): number {
  const turnMs = CHARTER_DEADLINE_TURNS * MS_PER_TURN;
  const irlMs = CHARTER_DEADLINE_MIN_IRL_HOURS * 60 * 60 * 1000;
  return Math.round(Math.max(turnMs, irlMs) / MS_PER_TURN);
}

/** Absolute turn on which a draft / founder-replacement deadline fires. */
export function computeCharterDeadlineTurn(startTurn: number): number {
  return startTurn + computeCharterDeadlineTurns();
}
