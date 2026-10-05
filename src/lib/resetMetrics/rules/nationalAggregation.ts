import { primaryMetrics } from "../catalog";
import type { OpeningMetricObservation, ObservationStatus } from "./openingObservation";
import type { ResetMetricHistoryPoint } from "./history";

export interface NationalMetricRegionReading {
  regionId: string;
  population: number;
  workingAgePopulation?: number;
  votingEligiblePopulation?: number;
  gdp?: number;
  observations: Readonly<Record<string, OpeningMetricObservation>>;
}

type WeightKind = "population" | "working-age population" | "eligible population" | "GDP";

const GDP_WEIGHTED_IDS = new Set(["05", "06", "08", "15"]);
const WORKING_AGE_WEIGHTED_IDS = new Set(["01", "13"]);
const ELIGIBLE_WEIGHTED_IDS = new Set(["51"]);

export function preferredNationalMetricWeight(
  metricId: string,
  region: NationalMetricRegionReading
): { value: number; kind: WeightKind; fallback: boolean } {
  const preferred = GDP_WEIGHTED_IDS.has(metricId)
    ? { value: region.gdp, kind: "GDP" as const }
    : WORKING_AGE_WEIGHTED_IDS.has(metricId)
      ? { value: region.workingAgePopulation, kind: "working-age population" as const }
      : ELIGIBLE_WEIGHTED_IDS.has(metricId)
        ? { value: region.votingEligiblePopulation, kind: "eligible population" as const }
        : { value: region.population, kind: "population" as const };
  if (
    typeof preferred.value === "number" &&
    Number.isFinite(preferred.value) &&
    preferred.value > 0
  ) {
    return { value: preferred.value, kind: preferred.kind, fallback: false };
  }
  if (!Number.isFinite(region.population) || region.population <= 0) {
    throw new Error(`National metric rollup has no usable weight for ${region.regionId}`);
  }
  return { value: region.population, kind: "population", fallback: true };
}

function rollupStatus(
  observations: readonly OpeningMetricObservation[],
  aggregation: string,
  fallback: boolean
): ObservationStatus {
  if (fallback || observations.some((observation) => observation.status === "proxy")) {
    return "proxy";
  }
  // A weighted mean is the approved read model for population-weighted
  // measures. Other catalog methods ultimately need their owner-specific
  // national numerator, denominator, asset, area, or hazard stock.
  return aggregation === "population_weighted" ? "derived" : "proxy";
}

/**
 * Build the national read model for region-owned primary metrics.
 *
 * This does not create a second owner or mutate a stored observation. It is a
 * portable rollup over the current regional owner readings. Where the game
 * does not persist the catalog's ideal national denominator, the result stays
 * explicitly provisional instead of presenting a weighted mean as sourced
 * national data.
 */
export function aggregateNationalMetricObservations(
  regions: readonly NationalMetricRegionReading[]
): Record<string, OpeningMetricObservation> {
  if (
    regions.length === 0 ||
    new Set(regions.map((region) => region.regionId)).size !== regions.length
  ) {
    throw new Error("National metric rollup requires distinct regional readings");
  }

  return Object.fromEntries(
    primaryMetrics
      .filter((metric) => metric.aggregation !== "national")
      .map((metric) => {
        let weightedValue = 0;
        let totalWeight = 0;
        let fallback = false;
        let kind: WeightKind | null = null;
        const observations: OpeningMetricObservation[] = [];

        for (const region of regions) {
          const observation = region.observations[metric.id];
          if (
            !observation ||
            observation.metricId !== metric.id ||
            observation.path !== metric.path ||
            observation.owner !== metric.owner ||
            typeof observation.value !== "number" ||
            !Number.isFinite(observation.value) ||
            observation.status === "unavailable"
          ) {
            throw new Error(`National metric rollup is missing ${region.regionId}/${metric.id}`);
          }
          const weight = preferredNationalMetricWeight(metric.id, region);
          kind ??= weight.kind;
          if (kind !== weight.kind) fallback = true;
          fallback ||= weight.fallback;
          weightedValue += observation.value * weight.value;
          totalWeight += weight.value;
          observations.push(observation);
        }

        if (totalWeight <= 0 || !kind) {
          throw new Error(`National metric rollup has no denominator for ${metric.id}`);
        }
        const status = rollupStatus(observations, metric.aggregation, fallback);
        const isProvisional = status === "proxy";
        return [
          metric.id,
          {
            metricId: metric.id,
            path: metric.path,
            value: weightedValue / totalWeight,
            status,
            source: `${kind}-weighted national rollup of current regional v2 observations`,
            owner: metric.owner,
            note: isProvisional
              ? `Game-calibrated national rollup. The ${metric.aggregation} owner-specific national denominator is not yet persisted separately.`
              : `National rollup using the catalog's ${metric.aggregation} aggregation rule.`,
          },
        ];
      })
  );
}

export function aggregateNationalMetricValue(
  metricId: string,
  regions: readonly NationalMetricRegionReading[]
): number {
  let weightedValue = 0;
  let totalWeight = 0;
  for (const region of regions) {
    const observation = region.observations[metricId];
    if (
      !observation ||
      typeof observation.value !== "number" ||
      !Number.isFinite(observation.value)
    ) {
      throw new Error(`National metric rollup is missing ${region.regionId}/${metricId}`);
    }
    const weight = preferredNationalMetricWeight(metricId, region).value;
    weightedValue += observation.value * weight;
    totalWeight += weight;
  }
  if (totalWeight <= 0)
    throw new Error(`National metric rollup has no denominator for ${metricId}`);
  return weightedValue / totalWeight;
}

export function aggregateNationalMetricHistory(
  metricId: string,
  regions: readonly (NationalMetricRegionReading & {
    history: Readonly<Record<string, readonly ResetMetricHistoryPoint[]>>;
  })[]
): ResetMetricHistoryPoint[] {
  if (regions.length === 0) return [];
  const turns = regions[0]!.history[metricId]?.map((point) => point.turn) ?? [];
  if (
    turns.length === 0 ||
    regions.some(
      (region) =>
        region.history[metricId]?.length !== turns.length ||
        region.history[metricId]?.some((point, index) => point.turn !== turns[index])
    )
  ) {
    throw new Error(`National metric history is not aligned for ${metricId}`);
  }
  return turns.map((turn, index) => {
    let weightedValue = 0;
    let totalWeight = 0;
    for (const region of regions) {
      const point = region.history[metricId]![index]!;
      const weight = preferredNationalMetricWeight(metricId, region).value;
      weightedValue += point.value * weight;
      totalWeight += weight;
    }
    return { turn, value: weightedValue / totalWeight };
  });
}
