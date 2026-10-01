/**
 * Reset primary metrics. The catalog names the 58 proposed outcomes, explains
 * their inputs, and identifies the single owning system for each observation.
 * primaryMetrics is descriptive data; laws must not write these values directly.
 */

import catalog from "./primaryCatalog.json";

export type MetricInterpretation = "higher" | "lower" | "band" | "context";
export type MetricOpeningSource = "carry" | "derive" | "recompute";

export interface PrimaryMetricDefinition {
  id: string;
  path: string;
  name: string;
  description: string;
  unit: string;
  interpretation: MetricInterpretation;
  refresh: string;
  aggregation: string;
  owner: string;
  openingSource: MetricOpeningSource;
}

export const primaryMetrics: readonly PrimaryMetricDefinition[] =
  catalog as PrimaryMetricDefinition[];

export function primaryMetricById(id: string): PrimaryMetricDefinition | undefined {
  return primaryMetrics.find((metric) => metric.id === id);
}

export function primaryMetricByPath(path: string): PrimaryMetricDefinition | undefined {
  return primaryMetrics.find((metric) => metric.path === path);
}
