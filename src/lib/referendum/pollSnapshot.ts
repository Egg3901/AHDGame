/**
 * Pure helpers for a referendum's per-turn Yes-share series (`pollHistory`).
 * The lifecycle phase calls `upsertPollPoint` each campaigning turn; momentum
 * and the chart read the resulting array. Window-bounded, so it stays small.
 */
import { POLL_HISTORY_CAP } from "@/lib/constants/referendum";

export interface PollPoint {
  turn: number;
  yesShare: number;
}

/**
 * Insert (or replace) the reading for `turn`, keep the series turn-ascending,
 * clamp the value to [0, 100], and trim to the most recent `cap` points.
 * Idempotent by turn: re-running a turn overwrites rather than duplicates.
 */
export function upsertPollPoint(
  history: PollPoint[] | undefined,
  turn: number,
  yesShare: number,
  cap: number = POLL_HISTORY_CAP
): PollPoint[] {
  const clamped = Math.max(0, Math.min(100, yesShare));
  const next = [
    ...(history ?? []).filter((p) => p.turn !== turn),
    { turn, yesShare: clamped },
  ].sort((a, b) => a.turn - b.turn);
  return next.length > cap ? next.slice(next.length - cap) : next;
}
