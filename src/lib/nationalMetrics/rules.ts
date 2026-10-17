/**
 * Pure aggregation rules for regional metrics rolled into a national document.
 * Absolute labor-force counts are summed; unemployment rates use the labor
 * force as their denominator. Other rates retain the existing population (or
 * GDP) weighting.
 */
export interface NationalMetricRegionValue {
  value: number;
  population: number;
  gdp: number;
  laborForce?: number;
}

export interface NationalLabourMetricReading {
  demand?: number;
  laborForce?: number;
  demandTurn?: number;
}

const ROUNDING_SCALE = 1_000;

function roundMetric(value: number): number {
  return Math.round(value * ROUNDING_SCALE) / ROUNDING_SCALE;
}

function hasCompleteCurrentDemand(
  readings: readonly NationalLabourMetricReading[],
  turn: number
): boolean {
  return (
    readings.length > 0 &&
    readings.every(
      ({ demand, demandTurn }) =>
        demandTurn === turn && typeof demand === "number" && Number.isFinite(demand) && demand >= 0
    )
  );
}

/** Sum regional corporate headcounts only when every region has this turn's reading. */
export function aggregateNationalLabourDemand(
  readings: readonly NationalLabourMetricReading[],
  turn: number
): number | undefined {
  if (!Number.isFinite(turn) || !hasCompleteCurrentDemand(readings, turn)) return undefined;
  return Math.round(readings.reduce((sum, reading) => sum + reading.demand!, 0));
}

/** Derive national tightness from complete current-turn demand and labor-force counts. */
export function aggregateNationalLabourTightness(
  readings: readonly NationalLabourMetricReading[],
  turn: number
): number | undefined {
  if (!Number.isFinite(turn) || !hasCompleteCurrentDemand(readings, turn)) return undefined;
  if (
    !readings.every(
      ({ laborForce }) =>
        typeof laborForce === "number" && Number.isFinite(laborForce) && laborForce >= 0
    )
  ) {
    return undefined;
  }
  const totalLaborForce = readings.reduce((sum, reading) => sum + reading.laborForce!, 0);
  if (totalLaborForce <= 0) return undefined;
  const totalDemand = readings.reduce((sum, reading) => sum + reading.demand!, 0);
  return roundMetric(totalDemand / totalLaborForce);
}

/**
 * Aggregate a regional metric. Missing/invalid values are excluded.
 * Use labor-force weights for unemployment only when every regional rate being
 * aggregated has a valid labor-force value. Partial coverage can bias the
 * national result, so fall back to population rather than silently excluding
 * regions. This also supports older worlds without the labor-force field.
 */
export function aggregateNationalMetricValue(
  category: string,
  metricId: string,
  regions: readonly NationalMetricRegionValue[]
): number | undefined {
  if (category === "economic" && metricId === "laborForce") {
    const counts = regions.filter(({ value }) => Number.isFinite(value) && value >= 0);
    if (counts.length === 0) return undefined;
    return roundMetric(counts.reduce((sum, { value }) => sum + value, 0));
  }

  const validValues = regions.filter(({ value }) => Number.isFinite(value));
  if (validValues.length === 0) return undefined;

  if (category === "economic" && metricId === "unemploymentRate") {
    const laborForceWeighted = validValues.filter(
      ({ laborForce }) =>
        typeof laborForce === "number" && Number.isFinite(laborForce) && laborForce > 0
    );
    if (laborForceWeighted.length === validValues.length) {
      const totalLaborForce = laborForceWeighted.reduce((sum, row) => sum + row.laborForce!, 0);
      const weightedUnemployment = laborForceWeighted.reduce(
        (sum, row) => sum + row.value * row.laborForce!,
        0
      );
      return roundMetric(weightedUnemployment / totalLaborForce);
    }
  }

  const useGdpWeight = category === "economic" && metricId === "gdpGrowth";
  const populationWeighted = validValues.reduce(
    (acc, row) => {
      const weight = useGdpWeight ? row.gdp : row.population;
      if (Number.isFinite(weight) && weight > 0) {
        acc.weightedSum += row.value * weight;
        acc.totalWeight += weight;
      }
      return acc;
    },
    { weightedSum: 0, totalWeight: 0 }
  );
  if (populationWeighted.totalWeight <= 0) return undefined;
  return roundMetric(populationWeighted.weightedSum / populationWeighted.totalWeight);
}
