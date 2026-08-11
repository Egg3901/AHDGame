import type { StateMetricBaseline } from "@/lib/db/types/statePolicy";
import type { StateMetrics, StateMetricValue } from "@/lib/db/types";
import { ddStateMetrics } from "./ddStateMetrics";

/** East Germany region metric baselines — derived 1:1 from ddStateMetrics. */
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

export const ddStateBaselines: StateMetricBaseline[] = ddStateMetrics.map(toBaseline);
