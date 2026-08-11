import type { StateMetricBaseline } from "@/lib/db/types/statePolicy";
import type { StateMetrics, StateMetricValue } from "@/lib/db/types";
import { brStateMetrics } from "./brStateMetrics";

/**
 * Brazil macro-region metric baselines — the "resting" value each metric
 * decays toward when no policy intervention is active.
 *
 * Derived from brStateMetrics so a freshly seeded game has zero decay
 * pressure (baselines match current values 1:1). Any metric that changes
 * in brStateMetrics automatically updates the baseline here.
 */

type StateMetricCategory = Exclude<keyof StateMetrics, "_id" | "lastUpdated">;

function flattenCategory(
  category: Partial<Record<string, StateMetricValue>>
): Record<string, number> {
  const result: Record<string, number> = {};
  for (const [key, metric] of Object.entries(category)) {
    if (metric) result[key] = metric.value;
  }
  return result;
}

function toBaseline(metrics: StateMetrics): StateMetricBaseline {
  const categories: StateMetricCategory[] = [
    "economic",
    "education",
    "healthcare",
    "infrastructure",
    "publicSafety",
    "environment",
    "social",
    "governance",
    "population",
    "mediaInformation",
  ];

  const baselines: Record<string, Record<string, number>> = {};
  for (const cat of categories) {
    baselines[cat] = flattenCategory(metrics[cat] as Record<string, StateMetricValue>);
  }

  return { _id: metrics._id, baselines };
}

export const brStateBaselines: StateMetricBaseline[] = brStateMetrics.map(toBaseline);
