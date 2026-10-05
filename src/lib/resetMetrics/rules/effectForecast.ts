import type { PrimaryMetricDefinition } from "../catalog";
import { resetMetricConditionScore, type ResetMetricScoreCountry } from "../conditionScore";

export interface MetricEffectForecast {
  delta: number;
  projectedValue: number;
}

function initialStep(metric: PrimaryMetricDefinition, currentValue: number): number {
  if (metric.id === "02") return Math.max(1, Math.abs(currentValue) * 0.001);
  if (
    metric.unit.startsWith("%") ||
    metric.unit.includes("index") ||
    metric.unit.includes("points") ||
    metric.unit.includes("years")
  ) {
    return 0.01;
  }
  return Math.max(0.01, Math.abs(currentValue) * 0.001);
}

function score(
  metric: PrimaryMetricDefinition,
  value: number,
  countryId: ResetMetricScoreCountry,
  year: number
): number | null {
  return resetMetricConditionScore(metric, value, countryId, year);
}

/**
 * Convert a normalized favorable-pressure coefficient into a display-only
 * estimate in the metric owner's observed unit. The estimate follows the same
 * local condition calibration used by the Metrics board. It does not mutate
 * the observation or promise that an owner system will move by this amount.
 */
export function estimateObservedMetricChange(input: {
  metric: PrimaryMetricDefinition;
  currentValue: number | null;
  favorableNormalizedPoints: number;
  countryId: ResetMetricScoreCountry;
  year: number;
}): MetricEffectForecast | null {
  const { metric, currentValue, favorableNormalizedPoints, countryId, year } = input;
  if (
    currentValue === null ||
    !Number.isFinite(currentValue) ||
    !Number.isFinite(favorableNormalizedPoints)
  ) {
    return null;
  }
  if (favorableNormalizedPoints === 0) return { delta: 0, projectedValue: currentValue };

  const currentScore = score(metric, currentValue, countryId, year);
  if (currentScore === null) return null;
  const targetScore = Math.max(0, Math.min(100, currentScore + favorableNormalizedPoints));
  if (Math.abs(targetScore - currentScore) <= 1e-9) {
    return { delta: 0, projectedValue: currentValue };
  }
  const favorable = targetScore > currentScore;
  const reachedTarget = (candidateScore: number) =>
    favorable ? candidateScore >= targetScore : candidateScore <= targetScore;
  const movesTowardTarget = (candidateScore: number) =>
    favorable ? candidateScore > currentScore + 1e-9 : candidateScore < currentScore - 1e-9;
  const turnedAway = (candidateScore: number, previousScore: number) =>
    favorable ? candidateScore < previousScore - 1e-9 : candidateScore > previousScore + 1e-9;

  const baseStep = initialStep(metric, currentValue);
  const forecasts: MetricEffectForecast[] = [];

  for (const direction of [-1, 1] as const) {
    let distance = baseStep;
    let previousScore = currentScore;
    let improving = false;
    for (let attempt = 0; attempt < 48; attempt += 1) {
      const candidateValue = currentValue + direction * distance;
      const candidateScore = score(metric, candidateValue, countryId, year);
      if (candidateScore === null) break;
      if (movesTowardTarget(candidateScore)) improving = true;
      if (reachedTarget(candidateScore)) {
        let low = 0;
        let high = distance;
        for (let iteration = 0; iteration < 48; iteration += 1) {
          const middle = (low + high) / 2;
          const middleScore = score(metric, currentValue + direction * middle, countryId, year);
          if (middleScore !== null && reachedTarget(middleScore)) high = middle;
          else low = middle;
        }
        const delta = direction * high;
        forecasts.push({ delta, projectedValue: currentValue + delta });
        break;
      }
      if (improving && turnedAway(candidateScore, previousScore)) break;
      previousScore = candidateScore;
      distance *= 2;
    }
  }

  return forecasts.sort((left, right) => Math.abs(left.delta) - Math.abs(right.delta))[0] ?? null;
}
