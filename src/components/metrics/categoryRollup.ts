import { scoreMetric } from "@/lib/utils/metricScoring";

export interface CategoryRollup {
  /** Mean 0–100 score across scorable metrics. */
  avgScore: number;
  /** Count of metrics scoring "Good" or better (>= 55). */
  strong: number;
  /** Count of metrics scoring below "Fair" (< 40). */
  weak: number;
  /** Number of scorable metrics counted. */
  count: number;
}

/** Minimal shape needed from a category summary to roll up scores. */
type SummaryLike = Record<string, { populationWeightedAverage: number }>;

/**
 * Roll a category's metric summaries up into an average score + strong/weak
 * counts. Metrics with no scoring threshold are skipped (so the counts reflect
 * only scorable metrics). Tier boundaries mirror `getMetricBadge`.
 */
export function categoryRollup(
  summary: SummaryLike,
  countryId: string,
  preset?: string,
  /** Live year for era-aware score bands (null/omitted = legacy). */
  year?: number | null,
  /** medianIncome era-band inputs (null/omitted = legacy band). */
  incomeIndex?: number | null,
  startingYear?: number | null
): CategoryRollup {
  let sum = 0;
  let count = 0;
  let strong = 0;
  let weak = 0;
  for (const [metricId, data] of Object.entries(summary)) {
    const score = scoreMetric(
      metricId,
      data.populationWeightedAverage,
      countryId,
      preset,
      year,
      incomeIndex,
      startingYear
    );
    if (score === null) continue;
    sum += score;
    count += 1;
    if (score >= 55) strong += 1;
    else if (score < 40) weak += 1;
  }
  return {
    avgScore: count > 0 ? Math.round(sum / count) : 0,
    strong,
    weak,
    count,
  };
}
