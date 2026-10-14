/**
 * Policy drift for v2 metrics that have no physical live ledger yet.
 *
 * Until an owner system measures a metric, its observation is a carry-forward
 * of the opening value. That left enacted laws and Cabinet initiatives as a
 * display-only "pressure" line: the board showed the push, the number never
 * moved (ticket 1539). This rule gives that pressure a settlement: the
 * condition score the metric drifts toward is the opening score plus the
 * combined normalized pressure scaled to condition points, and each refresh
 * closes a cadence-sized share of the remaining gap. When the pressure goes
 * away (a program defunded, a temporary action expired) the value drifts back
 * toward its opening, so nothing becomes a permanent bonus.
 *
 * Derived and fail-closed owners never pass through here; the live ledger
 * stays authoritative for them.
 */
import type { PrimaryMetricDefinition } from "../catalog";
import type { ResetMetricScoreCountry } from "../conditionScore";
import { estimateObservedMetricChange } from "./effectForecast";

/**
 * Condition points (0-100 scale) at full settlement per unit of normalized
 * pressure. One fully funded replacement law carries roughly 0.5 to 0.9
 * normalized points, so a single law settles 12 to 22 condition points above
 * the opening: a step a player can see, short of a full-scale swing.
 */
export const POLICY_PRESSURE_SCORE_POINTS = 25;

/** Fraction of the remaining gap closed per turn; a 34 turn half-life. */
export const POLICY_DRIFT_RATE_PER_TURN = 0.02;

/** Share of the gap one refresh closes when the metric refreshes every `cadenceTurns`. */
export function policyDriftFraction(cadenceTurns: number): number {
  const turns = Number.isSafeInteger(cadenceTurns) && cadenceTurns > 0 ? cadenceTurns : 1;
  return 1 - Math.pow(1 - POLICY_DRIFT_RATE_PER_TURN, turns);
}

/** Refresh cadence in turns for a metric definition; cohort-refreshed metrics refresh each turn. */
export function policyDriftCadence(metric: PrimaryMetricDefinition): number {
  const cadence = Number(metric.refresh);
  return Number.isSafeInteger(cadence) && cadence > 0 ? cadence : 1;
}

export interface PolicyDriftInput {
  metric: PrimaryMetricDefinition;
  currentValue: number;
  openingValue: number;
  /** Combined normalized favorable pressure from funded laws and active Cabinet actions. */
  pressure: number;
  countryId: ResetMetricScoreCountry;
  year: number;
}

/**
 * The value this metric settles at under the given pressure: the opening
 * value moved until its condition score gains `pressure × scale` points.
 * Null when the metric has no condition calibration.
 */
export function policyDriftTarget(input: PolicyDriftInput): number | null {
  const { metric, openingValue, pressure, countryId, year } = input;
  if (!Number.isFinite(openingValue) || !Number.isFinite(pressure)) return null;
  if (pressure === 0) return openingValue;
  const forecast = estimateObservedMetricChange({
    metric,
    currentValue: openingValue,
    favorableNormalizedPoints: pressure * POLICY_PRESSURE_SCORE_POINTS,
    countryId,
    year,
  });
  return forecast ? forecast.projectedValue : null;
}

/**
 * One refresh of drift toward the settlement. Returns the current value
 * unchanged when the metric cannot be scored, so an uncalibrated metric stays
 * a plain carry-forward instead of inventing motion.
 */
export function driftProxyValue(input: PolicyDriftInput): number {
  const { metric, currentValue } = input;
  if (!Number.isFinite(currentValue)) return currentValue;
  const target = policyDriftTarget(input);
  if (target === null) return currentValue;
  const gap = target - currentValue;
  if (Math.abs(gap) < 1e-9) return target;
  const next = currentValue + gap * policyDriftFraction(policyDriftCadence(metric));
  // Six decimals: enough for every catalog unit, and it keeps replay equality
  // exact across the compare-and-swap in refreshResetMetricSnapshotsTurn.
  const rounded = Number(next.toFixed(6));
  // Snap the last micro-gap so rounding cannot strand a value just short of
  // its settlement.
  return Math.abs(target - rounded) < 1e-4 ? target : rounded;
}
