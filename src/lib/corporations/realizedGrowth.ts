import { GROWTH_RATE_TURNS_PER_YEAR } from "@/lib/constants/corporations";

/**
 * Realized revenue growth for ONE corporation, for display.
 *
 * Why this exists: under `marketSystemMode >= "plants"` a sector's
 * `currentGrowthRate` field no longer drives revenue — revenue is derived from
 * produced units against plant capacity — so the field is vestigial and sits at
 * 0 for most corporations. The corporation pages were still averaging it and
 * printing the result as "Average Growth Rate", which is how every corporation
 * came to read 0.00% (#922). The honest replacement is the same one the GDP
 * signal took for regions: measure the realized revenue the corp actually
 * booked, and annualize it.
 *
 * Deliberately NOT the region helper (`computeRealizedRevenueGrowthRate`): that
 * clamps into the GDP signal band [-10, 15], which is right for an input to the
 * output gap and wrong for a number shown to a CEO — a corporation genuinely
 * growing 40%/yr must not read 15%.
 */

/** Widest span worth measuring over: one game year. */
export const CORP_GROWTH_TARGET_SPAN_TURNS = GROWTH_RATE_TURNS_PER_YEAR;
/**
 * Youngest baseline we will annualize from. Annualizing a single turn multiplies
 * ordinary revenue churn by 48, so a ±10% settlement wobble prints as ±480%;
 * requiring a span divides the noise instead of multiplying it.
 */
export const CORP_GROWTH_MIN_SPAN_TURNS = 8;

export interface CorpRevenuePoint {
  turn: number;
  revenue: number;
}

/**
 * Annualized percentage growth between the newest revenue point and the oldest
 * usable baseline, or null when there is no baseline worth trusting (a corp
 * younger than the minimum span, a zero/absent prior, or a non-positive gap).
 * The caller falls back to whatever it showed before rather than inventing a
 * number.
 */
export function computeCorpRealizedGrowthRate(points: readonly CorpRevenuePoint[]): number | null {
  const usable = points
    .filter((p) => Number.isFinite(p.turn) && Number.isFinite(p.revenue))
    .sort((a, b) => a.turn - b.turn);
  if (usable.length < 2) return null;

  const now = usable[usable.length - 1]!;
  if (!(now.revenue >= 0)) return null;

  // Prefer a baseline close to a year back; otherwise the oldest point that
  // still clears the minimum span.
  const candidates = usable
    .slice(0, -1)
    .filter((p) => now.turn - p.turn >= CORP_GROWTH_MIN_SPAN_TURNS && p.revenue > 0);
  if (candidates.length === 0) return null;

  let baseline = candidates[0]!;
  for (const point of candidates) {
    const bestGap = Math.abs(now.turn - baseline.turn - CORP_GROWTH_TARGET_SPAN_TURNS);
    const thisGap = Math.abs(now.turn - point.turn - CORP_GROWTH_TARGET_SPAN_TURNS);
    if (thisGap < bestGap) baseline = point;
  }

  const spanTurns = now.turn - baseline.turn;
  if (spanTurns <= 0) return null;

  const raw =
    (now.revenue / baseline.revenue - 1) * 100 * (CORP_GROWTH_TARGET_SPAN_TURNS / spanTurns);
  return Number.isFinite(raw) ? raw : null;
}
