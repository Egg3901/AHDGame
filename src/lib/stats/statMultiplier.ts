import { EFFICACY_PIVOT, EFFICACY_SLOPE, clampStat } from "./statsConstants";

/**
 * Gentle ±20% efficacy multiplier for a stat value. Applied to action OUTCOMES
 * (never to costs, except Intellect's explicit campaign cost-curve hook):
 *
 *   stat 1   → 0.82×
 *   stat 5–6 → ~1.0×  (baseline)
 *   stat 10  → 1.18×
 *
 * Out-of-range input is clamped to the legal [1, 10] band so callers can pass
 * raw stored values without pre-clamping.
 */
export function statMultiplier(stat: number): number {
  return 1 + (clampStat(stat) - EFFICACY_PIVOT) * EFFICACY_SLOPE;
}
