import { METRIC_DEFS_BY_CATEGORY } from "@/lib/constants/metricDefinitions";

/**
 * Whether a rise in an underlying statistic is good for the country, read from
 * the macro metric catalog the evidence rows are drawn from (its economic and
 * population categories). Null when the statistic is not in that catalog, as
 * with the prime rate, inflation and debt to GDP rows.
 */
export function risingIsGood(statisticId: string): boolean | null {
  const definition =
    METRIC_DEFS_BY_CATEGORY.economic[statisticId] ??
    METRIC_DEFS_BY_CATEGORY.population[statisticId];
  return definition ? definition.isHigherBetter : null;
}

/**
 * Colour for an underlying statistic's trend arrow: green when the move is good
 * for the country and red when it is bad, so rising unemployment reads red.
 * Where the polarity is not known, a rise stays green and a fall red.
 */
export function evidenceTrendClass(statisticId: string, trend: number): string {
  const rising = trend > 0;
  const good = risingIsGood(statisticId);
  const favourable = good === null ? rising : rising === good;
  return favourable ? "text-success" : "text-error";
}
