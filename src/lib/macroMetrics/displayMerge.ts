/**
 * DISPLAY-side metric reads: the merged legacy doc with a region's political
 * BOARD projected over the political half.
 *
 * Deliberately a SEPARATE module from merge.ts, for two reasons:
 *
 *  1. Scorers must not use it. Approval already takes the board through
 *     `baseOverride`; the same board also arriving as legacy metrics
 *     double-counts it -- measured at +4 to +5 approval points when this was
 *     tried inside the shared merge. Only surfaces that RENDER legacy metric
 *     values belong here.
 *  2. merge.ts is imported almost everywhere, and this pulls in the metric
 *     definitions and adapter tables. Keeping that weight out of the hot module
 *     avoids perturbing unrelated tests that partially mock those.
 *
 * The split survives the stateMetrics deletion unchanged: scorers need nothing
 * more from merge.ts, and these display surfaces need exactly this.
 */
import type { Db, Filter } from "mongodb";
import type { StateMetrics } from "@/lib/db/types";
import type { PoliticalMetricsDoc } from "@/lib/db/types/politicalMetrics";
import type { PoliticalMetricId } from "@/lib/politicalMetrics/types";
import { legacyPoliticalHalfFromBoard } from "@/lib/politicalLegislation/legacyProjection";
import { findMergedRegionMetrics, findMergedRegionMetricsMany } from "./merge";

/** The merged legacy doc for one region, with its board projected over it. */
export async function findMergedRegionMetricsForDisplay(
  db: Db,
  filter: Record<string, unknown>
): Promise<StateMetrics | null> {
  const [merged, board] = await Promise.all([
    findMergedRegionMetrics(db, filter),
    db
      .collection<PoliticalMetricsDoc>("politicalMetrics")
      .findOne(filter as Filter<PoliticalMetricsDoc>),
  ]);
  return applyBoardProjection(merged, board);
}

/** Many-variant of {@link findMergedRegionMetricsForDisplay}. */
export async function findMergedRegionMetricsManyForDisplay(
  db: Db,
  filter: Record<string, unknown>
): Promise<StateMetrics[]> {
  const [merged, boards] = await Promise.all([
    findMergedRegionMetricsMany(db, filter),
    db
      .collection<PoliticalMetricsDoc>("politicalMetrics")
      .find(filter as Filter<PoliticalMetricsDoc>)
      .toArray(),
  ]);
  const boardById = new Map(boards.map((d) => [String(d._id), d]));
  return merged.map((m) => applyBoardProjection(m, boardById.get(String(m._id)) ?? null)!);
}

/** Overlay the board's legacy-shaped projection onto a merged doc. */
function applyBoardProjection(
  merged: StateMetrics | null,
  board: PoliticalMetricsDoc | null
): StateMetrics | null {
  const projected = legacyPoliticalHalfFromBoard(
    (board?.values ?? null) as Record<PoliticalMetricId, number> | null
  );
  if (!projected) return merged;
  const base: Record<string, unknown> = merged
    ? { ...(merged as unknown as Record<string, unknown>) }
    : { _id: board!._id, countryId: board!.countryId, lastUpdated: board!.lastUpdated };
  for (const [category, metrics] of Object.entries(projected)) {
    base[category] = { ...((base[category] as Record<string, unknown>) ?? {}), ...metrics };
  }
  return base as unknown as StateMetrics;
}
