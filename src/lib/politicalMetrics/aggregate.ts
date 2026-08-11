import type { PoliticalMetricsDoc } from "@/lib/db/types/politicalMetrics";
import { FAMILIES_BY_CATEGORY, POLITICAL_METRIC_FAMILIES } from "./families";
import {
  POLITICAL_METRIC_CATEGORIES,
  type PoliticalMetricCategoryId,
  type PoliticalMetricId,
} from "./types";

/**
 * Population-weighted national mean per family. The single seam where future
 * aggregation-math changes land (candidates: GDP-weighting economic families,
 * worst-region penalties for equality-flavored families) and where the dynamics
 * sub-project can start persisting a national doc.
 */
export function aggregateNationalPoliticalMetrics(
  docs: Pick<PoliticalMetricsDoc, "_id" | "values">[],
  populationByRegion: Map<string, number>
): Record<PoliticalMetricId, number> {
  const out = {} as Record<PoliticalMetricId, number>;
  for (const family of POLITICAL_METRIC_FAMILIES) {
    let weightedSum = 0;
    let totalWeight = 0;
    for (const doc of docs) {
      const weight = populationByRegion.get(doc._id) ?? 0;
      const value = doc.values[family.id];
      if (weight > 0 && typeof value === "number" && Number.isFinite(value)) {
        weightedSum += value * weight;
        totalWeight += weight;
      }
    }
    out[family.id] = totalWeight > 0 ? weightedSum / totalWeight : 0;
  }
  return out;
}

export function categoryScore(
  values: Record<PoliticalMetricId, number>,
  categoryId: PoliticalMetricCategoryId
): number {
  const fams = FAMILIES_BY_CATEGORY[categoryId];
  return fams.reduce((sum, f) => sum + (values[f.id] ?? 0), 0) / fams.length;
}

export function overallScore(values: Record<PoliticalMetricId, number>): number {
  return (
    POLITICAL_METRIC_CATEGORIES.reduce((sum, cat) => sum + categoryScore(values, cat.id), 0) /
    POLITICAL_METRIC_CATEGORIES.length
  );
}
