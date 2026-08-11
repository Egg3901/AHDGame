import {
  GROWTH_TREND_STEP_PER_TURN,
  MAX_GROWTH_RATE,
  MIN_GROWTH_RATE,
} from "@/lib/constants/corporations";

/**
 * Trends the current sector growth rate toward the player-set target by
 * GROWTH_TREND_STEP_PER_TURN (default 0.5 pp per turn). Clamps the result to
 * the sector growth range and stops exactly at target — no overshoot.
 *
 * Float inputs are tolerated (ranges are fractional), but the result is
 * rounded to 1 decimal place to avoid floating-point drift accumulating over
 * hundreds of turns.
 */
export function trendGrowthRate(current: number, target: number): number {
  const clampedTarget = Math.max(MIN_GROWTH_RATE, Math.min(MAX_GROWTH_RATE, target));
  if (current === clampedTarget) return current;
  const diff = clampedTarget - current;
  const step = Math.sign(diff) * Math.min(GROWTH_TREND_STEP_PER_TURN, Math.abs(diff));
  const next = current + step;
  const clamped = Math.max(MIN_GROWTH_RATE, Math.min(MAX_GROWTH_RATE, next));
  return Math.round(clamped * 10) / 10;
}
