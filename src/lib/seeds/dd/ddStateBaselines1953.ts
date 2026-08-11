import type { StateMetricBaseline } from "@/lib/db/types/statePolicy";
import type { StateMetrics, StateMetricValue } from "@/lib/db/types";
import { ddStateMetrics1953 } from "./ddStateMetrics1953";

/**
 * East Germany region metric baselines — 1953, derived 1:1 from ddStateMetrics1953.
 *
 * The bundle is already authored for 1953 (the decay targets ARE the era-correct
 * values), so — unlike the 1979 path — no applyEra1953BaselineAdjustments transform
 * is applied on top. Keyed to the eastern-Laender codes (BEO/MV/BB/ST/SN/TH).
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

export const ddStateBaselines1953: StateMetricBaseline[] = ddStateMetrics1953.map(toBaseline);
