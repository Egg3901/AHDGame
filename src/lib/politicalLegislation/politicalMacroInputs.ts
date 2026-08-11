/**
 * Bridge A — the ONE read the demographic and TFP engines use to resolve a
 * legacy stateMetrics path for a playable region.
 *
 * Playable regions have no stateMetrics doc at all (SP5), so those engines
 * currently fall through to neutral constants: identical mortality for every
 * playable country, and a TFP basket where 4 of 6 inputs sit at reference.
 * This resolves them from the political board instead, reusing ADAPTER_TIER1's
 * already-reviewed legacy→family mapping and converting to real units via
 * legacyUnitBands.
 *
 * A region absent from politicalMetrics returns null everywhere, so
 * non-playable callers keep their existing legacy read byte-identically.
 */
import type { Db } from "mongodb";
import type { PoliticalMetricsDoc } from "@/lib/db/types/politicalMetrics";
import type { PoliticalMetricId } from "@/lib/politicalMetrics/types";
import { politicalValueForLegacyMetric } from "./marginAdapter";
import { legacyUnitFromPoliticalScore } from "./legacyUnitBands";
import { legacyValueFromPoliticalScore } from "@/lib/politicalMetrics/derive/legacyInversion";

export interface PoliticalMacroInputs {
  /** True when the region is on the political board. */
  has(stateId: string): boolean;
  /**
   * Legacy "category.metricId" → REAL unit via a Bridge A BAND, or null when
   * the path has no band. Score 50 reproduces the consuming engine's own
   * neutral exactly, which is why the demographics and TFP engines use this.
   */
  legacyUnit(stateId: string, path: string): number | null;
  /**
   * Legacy "category.metricId" → REAL unit via the exact INVERSE of the
   * derivation, or null when the metric has no definition. Works for any
   * metric rather than the handful with authored bands, and score 50 lands on
   * the midpoint of the metric's realistic range rather than on a consumer
   * neutral. Use this where the consumer is simply asking "what value does
   * this region's board correspond to?"; use `legacyUnit` where an engine has
   * a neutral whose behaviour must be preserved.
   */
  legacyValue(stateId: string, path: string): number | null;
  /** Raw 0-100 family score by family id, or null when unavailable. */
  score(stateId: string, familyId: string): number | null;
}

export async function loadPoliticalMacroInputs(db: Db): Promise<PoliticalMacroInputs> {
  const docs = await db.collection<PoliticalMetricsDoc>("politicalMetrics").find({}).toArray();
  const valuesById = new Map<string, Record<PoliticalMetricId, number>>(
    docs.map((d) => [String(d._id), (d.values ?? {}) as Record<PoliticalMetricId, number>])
  );

  return {
    has: (stateId) => valuesById.has(stateId),
    legacyUnit(stateId, path) {
      const values = valuesById.get(stateId);
      if (!values) return null;
      const [category, metricId] = path.split(".");
      if (!category || !metricId) return null;
      const score = politicalValueForLegacyMetric(values, category, metricId);
      if (score == null) return null;
      return legacyUnitFromPoliticalScore(path, score);
    },
    legacyValue(stateId, path) {
      const values = valuesById.get(stateId);
      if (!values) return null;
      const [category, metricId] = path.split(".");
      if (!category || !metricId) return null;
      const score = politicalValueForLegacyMetric(values, category, metricId);
      if (score == null) return null;
      return legacyValueFromPoliticalScore(category, metricId, score);
    },
    score(stateId, familyId) {
      const values = valuesById.get(stateId);
      if (!values) return null;
      const v = values[familyId as PoliticalMetricId];
      return typeof v === "number" && Number.isFinite(v) ? v : null;
    },
  };
}
