/**
 * Population-weighted mean of a metric across a country's regions.
 *
 * The denominator is the population of the regions that actually CARRY the
 * metric, never the country total. Dividing a partial numerator by a total
 * denominator under-reports the average whenever coverage is incomplete, and
 * the two national surfaces previously disagreed on exactly this point: the
 * Economy page divided by covered population, the Metrics page by the country
 * total. They agree today only because coverage happens to be complete.
 */
export interface WeightedRow {
  value?: number;
  trend?: number;
  population: number;
}

export interface WeightedResult {
  value: number | null;
  trend: number | null;
  /** Population actually included in the denominator. */
  coveredPopulation: number;
}

export function populationWeightedAverage(rows: WeightedRow[]): WeightedResult {
  let valueSum = 0;
  let trendSum = 0;
  let coveredPopulation = 0;

  for (const row of rows) {
    if (typeof row.value !== "number" || !Number.isFinite(row.value)) continue;
    const population = Number.isFinite(row.population) ? row.population : 0;
    if (population <= 0) continue;
    valueSum += row.value * population;
    trendSum +=
      (typeof row.trend === "number" && Number.isFinite(row.trend) ? row.trend : 0) * population;
    coveredPopulation += population;
  }

  if (coveredPopulation <= 0) return { value: null, trend: null, coveredPopulation: 0 };
  return {
    value: valueSum / coveredPopulation,
    trend: trendSum / coveredPopulation,
    coveredPopulation,
  };
}
