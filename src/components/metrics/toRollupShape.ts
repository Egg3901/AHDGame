import type { MetricCategoryId, StateMetrics } from "@/lib/db/types";

/**
 * Transform a region's `StateMetrics` into the
 * `{ category: { metricId: { populationWeightedAverage } } }` shape the category
 * health overview consumes. For a regional view the "average" is simply the
 * region's own value, so the overview scores the region against absolute
 * thresholds (not against other regions).
 */
export function toRollupShape(
  metrics: StateMetrics,
  categories: { id: MetricCategoryId }[]
): Record<string, Record<string, { populationWeightedAverage: number }>> {
  const out: Record<string, Record<string, { populationWeightedAverage: number }>> = {};
  for (const { id } of categories) {
    const cat = metrics[id] as Record<string, { value?: number }> | undefined;
    if (!cat) continue;
    const entry: Record<string, { populationWeightedAverage: number }> = {};
    for (const [metricId, v] of Object.entries(cat)) {
      if (v && typeof v.value === "number")
        entry[metricId] = { populationWeightedAverage: v.value };
    }
    out[id] = entry;
  }
  return out;
}
