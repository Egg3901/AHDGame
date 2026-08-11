/**
 * Multiplicative score penalty derived from a candidate's infamy.
 *
 * 100% infamy → 5% reduction in score (multiplier 0.95).
 * Linear in between. Missing/null infamy → no penalty (multiplier 1.0).
 *
 * Used by both primary score and general-election vote distribution so the
 * penalty applies uniformly across the election pipeline.
 */

export const INFAMY_PENALTY_MAX = 0.05; // 5% reduction at infamy=100

/** Multiplicative penalty in [0.95, 1.0] based on infamy in [0, 100]. */
export function infamyPenaltyMultiplier(infamy: number | null | undefined): number {
  if (infamy == null || !Number.isFinite(infamy)) return 1;
  const clamped = Math.min(100, Math.max(0, infamy));
  return 1 - INFAMY_PENALTY_MAX * (clamped / 100);
}
