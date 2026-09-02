/**
 * The shapes the registry components render, at EITHER scope.
 *
 * The national and region loaders return different payloads (one has a
 * governance-style score and a `nationalValue` alias, the other a per-metric
 * `national` comparison and a `nationalScore` per category). These types are
 * the intersection the shared views actually consume, so one set of components
 * serves both without an adapter that reassigns fields — which is exactly what
 * let the old regional board drift out of parity with the national one.
 */

import type { CountryPoliticalMetricsResponse } from "@/lib/politicalMetrics/queries/countryPoliticalMetrics";
import type { GovernanceStyleScore } from "@/lib/governanceStyle/score";
import type { PoliticalMetricsCountryId } from "@/lib/politicalMetrics/types";

type NationalCategory = CountryPoliticalMetricsResponse["categories"][number];
type NationalMetric = NationalCategory["metrics"][number];

/**
 * `value` is the figure this payload is about: the country's at national scope,
 * the region's own at region scope.
 */
export type PMMetric = Omit<NationalMetric, "nationalValue"> & {
  /** The national payload's legacy alias for `value`. */
  nationalValue?: number;
  /** The country figure to compare against. Region scope only. */
  national?: number;
};

export type PMCategory = Omit<NationalCategory, "metrics"> & {
  metrics: PMMetric[];
  /** The country's score for this category. Region scope only. */
  nationalScore?: number;
};

export interface PMRegistryData {
  countryId: PoliticalMetricsCountryId;
  /** The name of whatever this registry is about: a country, or a region. */
  countryDisplayName: string;
  year: number;
  turn: number;
  overall: number;
  overallStatus: string;
  /** Country-scope only: party competition has no regional analogue. */
  governanceStyle?: GovernanceStyleScore;
  categories: PMCategory[];
}
