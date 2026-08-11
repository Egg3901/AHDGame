/**
 * Project a political board back into the LEGACY political-metric shape.
 *
 * The step-6 read seam. Dozens of display and scan consumers ask
 * `findMergedRegionMetrics` for a single legacy-shaped doc and then read
 * `education.literacyRate`, `governance.corruptionIndex` and so on. Converting
 * each of those call sites would be dozens of edits; projecting the board once,
 * inside the merge, cuts all of them over at a single point and means the
 * `stateMetrics` deletion needs no further consumer changes.
 *
 * Only metrics with an `ADAPTER_TIER1` row can be projected — that map is the
 * reviewed legacy↔family correspondence, already used forward for corp margins.
 * A legacy metric with no row is NOT invented here; it simply stays absent, and
 * the caller falls back to whatever the legacy doc still has.
 *
 * Values come back in the metric's own units via `legacyValueFromPoliticalScore`
 * (the exact inverse of the derivation), so a consumer reading
 * `healthcare.lifeExpectancy` gets years and `publicSafety.crimeRate` gets a
 * rate with the correct polarity — not a 0-100 score wearing a legacy name.
 */
import { ADAPTER_TIER1, politicalValueForLegacyMetric } from "./marginAdapter";
import { legacyValueFromPoliticalScore } from "@/lib/politicalMetrics/derive/legacyInversion";
import type { PoliticalMetricId } from "@/lib/politicalMetrics/types";

/**
 * Legacy categories the political board owns. `economic` and `population` are
 * macroMetrics' and are never projected — the merge takes those from the macro
 * doc, and overwriting them here would clobber live economic state with a
 * board-derived approximation.
 */
const PROJECTED_CATEGORIES = new Set([
  "education",
  "healthcare",
  "infrastructure",
  "publicSafety",
  "environment",
  "social",
  "governance",
  "mediaInformation",
]);

/** Legacy paths the board can supply, derived from the adapter once. */
const PROJECTABLE_PATHS: string[] = Object.keys(ADAPTER_TIER1).filter((path) =>
  PROJECTED_CATEGORIES.has(path.split(".")[0])
);

/**
 * `{ category: { metricId: { value } } }` for every projectable path, or null
 * when the board is empty.
 *
 * `governance.independenceDesire` is deliberately NOT projected: it lives on
 * macroMetrics as feature state whose drift phase is its sole owner, and it has
 * no adapter row, so it can never appear here.
 */
export function legacyPoliticalHalfFromBoard(
  values: Record<PoliticalMetricId, number> | null | undefined
): Record<string, Record<string, { value: number }>> | null {
  if (!values || Object.keys(values).length === 0) return null;

  const out: Record<string, Record<string, { value: number }>> = {};
  for (const path of PROJECTABLE_PATHS) {
    const [category, metricId] = path.split(".");
    const score = politicalValueForLegacyMetric(values, category, metricId);
    if (score == null) continue;
    const value = legacyValueFromPoliticalScore(category, metricId, score);
    if (value == null || !Number.isFinite(value)) continue;
    (out[category] ??= {})[metricId] = { value };
  }
  return Object.keys(out).length > 0 ? out : null;
}
