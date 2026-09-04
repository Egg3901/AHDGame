import { COVERAGE_DECAY_PER_TURN, COVERAGE_MAX } from "./config";

export function clampCoverage(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(COVERAGE_MAX, value));
}

/**
 * Live coverage, derived from the stored reading and how long ago it was taken.
 *
 * Derived rather than written: decay is a pure function of `lastCollectedTurn`,
 * so rewriting every coverage row every turn would buy nothing. This is the same
 * lazy-refresh reasoning `DiplomaticActionBudget` documents for its own budget.
 *
 * A negative elapsed count is treated as zero: a replayed or skewed turn must
 * never hand back MORE coverage than was collected.
 */
export function currentCoverage(valueAtCollection: number, turnsElapsed: number): number {
  const elapsed = Math.max(0, turnsElapsed);
  return clampCoverage(valueAtCollection - COVERAGE_DECAY_PER_TURN * elapsed);
}
