import type { PrimaryMetricDefinition } from "./catalog";
import { politicalScoreFromLegacyValue } from "@/lib/politicalMetrics/derive/legacyInversion";

export type ResetMetricScoreCountry = "US" | "UK" | "JP";

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function linearScore(value: number, worst: number, best: number): number {
  if (!Number.isFinite(value) || best === worst) return 50;
  return clampScore(((value - worst) / (best - worst)) * 100);
}

function preferredBandScore(
  value: number,
  preferredLow: number,
  preferredHigh: number,
  outerLow: number,
  outerHigh: number
): number {
  if (!Number.isFinite(value)) return 50;
  if (value >= preferredLow && value <= preferredHigh) return 100;
  if (value < preferredLow) return linearScore(value, outerLow, preferredLow);
  return linearScore(value, outerHigh, preferredHigh);
}

type LegacyAdapter = {
  category: string;
  metricId: string;
  value: (value: number) => number;
};

const LEGACY_ADAPTERS: Partial<Record<string, LegacyAdapter>> = {
  "02": { category: "economic", metricId: "medianIncome", value: (value) => value },
  "12": { category: "education", metricId: "testPerformance", value: (value) => value },
  "16": {
    category: "healthcare",
    metricId: "uninsuredRate",
    value: (value) => 100 - value,
  },
  "18": { category: "healthcare", metricId: "nhsWaitingTime", value: (value) => value },
  "32": { category: "publicSafety", metricId: "crimeRate", value: (value) => value },
  "35": {
    category: "environment",
    metricId: "airQuality",
    value: (value) => 100 - value,
  },
  "56": {
    category: "population",
    metricId: "dependencyRatio",
    value: (value) => value / 100,
  },
};

/**
 * Display-only 0-100 condition normalization for domain summaries.
 *
 * Primary observations retain their real units. This adapter exists only so a
 * domain can summarize unlike measures without averaging dollars, rates, and
 * indexes directly. Most measures reuse the established game quality bands;
 * explicit cases cover the v2 metrics whose units differ from their v1 source.
 */
export function resetMetricConditionScore(
  metric: PrimaryMetricDefinition,
  value: number | null,
  countryId: ResetMetricScoreCountry,
  year: number
): number | null {
  if (value === null || !Number.isFinite(value)) return null;

  switch (metric.id) {
    case "07":
      return preferredBandScore(value, 1, 3, -3, 12);
    case "15":
      return linearScore(value, 50, 150);
    case "24":
      return linearScore(value, 160, 60);
    case "55":
      return preferredBandScore(value, 1.9, 2.3, 0.8, 3.5);
    case "58":
      return linearScore(value, 100, 0);
  }

  const adapter = LEGACY_ADAPTERS[metric.id];
  const category = adapter?.category ?? metric.path.split(".")[0];
  const metricId = adapter?.metricId ?? metric.path.split(".")[1];
  if (!category || !metricId) return null;
  const adaptedValue = adapter ? adapter.value(value) : value;
  return politicalScoreFromLegacyValue(category, metricId, adaptedValue, countryId, year);
}
