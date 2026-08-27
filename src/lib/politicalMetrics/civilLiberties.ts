import type { Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { PoliticalMetricsDoc } from "@/lib/db/types/politicalMetrics";
import type { PoliticalMetricId } from "@/lib/politicalMetrics/types";
import { DEMOCRATIC_HEALTH_METRIC_IDS } from "@/lib/governanceStyle/score";

const clampMetric = (value: number): number => Math.max(0, Math.min(100, value));

/**
 * Apply a civil-liberties change to the complete Democratic Health basket.
 * Residuals receive the same delta so the political-metrics engine preserves
 * the structural cost instead of erasing it on the following turn.
 */
export async function applyCivilLibertiesDelta(
  db: Db,
  countryId: CountryId,
  delta: number
): Promise<number> {
  if (delta === 0) return 0;
  const docs = await db
    .collection<PoliticalMetricsDoc>("politicalMetrics")
    .find({ countryId })
    .toArray();
  if (docs.length === 0) return 0;

  const now = new Date();
  const operations = docs.map((doc) => {
    const values = { ...doc.values };
    const residuals = { ...(doc.residuals ?? {}) } as Record<PoliticalMetricId, number>;
    for (const metricId of DEMOCRATIC_HEALTH_METRIC_IDS) {
      const previous = values[metricId];
      if (typeof previous !== "number" || !Number.isFinite(previous)) continue;
      const next = clampMetric(previous + delta);
      const applied = next - previous;
      values[metricId] = next;
      residuals[metricId] = (residuals[metricId] ?? 0) + applied;
    }
    return {
      updateOne: {
        filter: { _id: doc._id },
        update: { $set: { values, residuals, lastUpdated: now } },
      },
    };
  });
  await db.collection<PoliticalMetricsDoc>("politicalMetrics").bulkWrite(operations);
  return operations.length;
}
