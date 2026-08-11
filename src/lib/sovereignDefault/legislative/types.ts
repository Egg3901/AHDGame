/**
 * Per-chamber voting phase for legislative ratification of a sovereign-crisis
 * resolution. One LegislativePhase entry is appended to the decision when a
 * chamber starts voting, mutated as votes come in, and stamped with an
 * outcome when the deadline closes.
 */

export type LegislativeChamberOutcome = "pending" | "passed" | "rejected";

export interface LegislativePhase {
  chamberKey: string;
  startedAtRealtimeMs: number;
  endsAtRealtimeMs: number;
  /**
   * Turn the chamber's voting window closes. Vote acceptance and the per-turn
   * processor resolve against this so the window freezes on pause and doesn't
   * drift with the game clock; `endsAtRealtimeMs` is the display/legacy fallback.
   */
  endsOnTurn?: number;
  votesFor: number;
  votesAgainst: number;
  votes: Record<string, "for" | "against">;
  outcome: LegislativeChamberOutcome;
}
