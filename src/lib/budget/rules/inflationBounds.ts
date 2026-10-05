/**
 * Range and per-turn movement rules for the settled CPI rate.
 *
 * Ordinary range: MIN_INFLATION..MAX_INFLATION. Inside it, a turn moves CPI by
 * at most MAX_PER_TURN_DELTA (the caller may widen the upward limit for deep
 * deflation recovery) and the result is clamped to the range. That is the
 * behaviour every in-range country has always had.
 *
 * Out-of-range recovery: a rate above MAX_INFLATION is a supported opening
 * condition (1991 BR, BG, RO, YU and the Union all start in hyperinflation).
 * It is never snapped to the ceiling. Instead:
 *   - it cannot rise; the ceiling for such a turn is the previous rate;
 *   - it falls toward the calculated rate by at most
 *     HYPERINFLATION_MAX_DISINFLATION_SHARE * previous, a proportional limit
 *     because hyperinflation unwinds on a log scale (always above the ordinary
 *     1.5pp step, since previous exceeds 100);
 *   - once it crosses MAX_INFLATION the ordinary rules take over.
 * At 3% of the level per turn, 480% takes about a game year to re-enter the
 * ordinary range, so the opening crisis is felt (wages, purchasing power,
 * household prices) instead of being erased on the first recalculation.
 *
 * Pure: plain numbers in, plain numbers out.
 */

export const MIN_INFLATION = -2.0;
export const MAX_INFLATION = 100.0;

/** Maximum ordinary |change| of CPI per turn, in percentage points.
 *  Prevents a single-turn spike when a previously-stuck wageGrowth value
 *  suddenly normalizes (or vice versa). At 48 turns per game year, 1.5pp per
 *  turn permits a 72pp same-direction arithmetic envelope in one year. This
 *  is not a predicted path: smoothing, mean reversion, and the absolute bounds
 *  can stop movement sooner. Deep-deflation recovery deliberately allows a
 *  larger one-turn upward correction when current drivers return near target. */
export const MAX_PER_TURN_DELTA = 1.5;

/** Largest share of an above-range rate that may unwind in one turn. */
export const HYPERINFLATION_MAX_DISINFLATION_SHARE = 0.03;

/**
 * Highest opening CPI the recovery contract supports. Matches the upper bound
 * accepted by client statistics; anything above it is not an authored opening.
 */
export const MAX_SUPPORTED_OPENING_INFLATION = 1000.0;

function roundRate(rate: number): number {
  return Math.round(rate * 100) / 100;
}

export interface InflationStepInput {
  /** Settled CPI from the previous turn (%). */
  previous: number;
  /** This turn's smoothed, mean-reverted CPI before any movement limit (%). */
  proposed: number;
  /** Upward movement limit for in-range rates; defaults to MAX_PER_TURN_DELTA. */
  maxPositiveDelta?: number;
}

/** Apply the per-turn movement limit and range bounds; returns the settled rate. */
export function settleInflationStep({
  previous,
  proposed,
  maxPositiveDelta = MAX_PER_TURN_DELTA,
}: InflationStepInput): number {
  if (previous > MAX_INFLATION) {
    const maxDecline = previous * HYPERINFLATION_MAX_DISINFLATION_SHARE;
    const next = Math.min(previous, Math.max(previous - maxDecline, proposed));
    return roundRate(Math.max(MIN_INFLATION, next));
  }
  const delta = Math.max(-MAX_PER_TURN_DELTA, Math.min(maxPositiveDelta, proposed - previous));
  return roundRate(Math.max(MIN_INFLATION, Math.min(MAX_INFLATION, previous + delta)));
}

export type OpeningInflationContract = "ordinary" | "hyperinflation-recovery" | "unsupported";

/** Classify an authored opening CPI against the runtime contract above. */
export function classifyOpeningInflation(rate: number): OpeningInflationContract {
  if (!Number.isFinite(rate) || rate < MIN_INFLATION) return "unsupported";
  if (rate <= MAX_INFLATION) return "ordinary";
  if (rate <= MAX_SUPPORTED_OPENING_INFLATION) return "hyperinflation-recovery";
  return "unsupported";
}

/** Turns an above-range rate needs to re-enter the ordinary range at the fastest allowed unwind. */
export function minimumTurnsToOrdinaryRange(rate: number): number {
  let current = rate;
  let turns = 0;
  while (current > MAX_INFLATION && turns < 10_000) {
    current = settleInflationStep({ previous: current, proposed: MIN_INFLATION });
    turns++;
  }
  return turns;
}
