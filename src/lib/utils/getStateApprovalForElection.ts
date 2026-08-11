/**
 * Fetches state government approval for use in election vote accumulation (party strength).
 * Returns 0-100. Uses BASE_APPROVAL (50) when metrics are missing.
 */

import { getDb } from "@/lib/mongodb";
import { findMergedRegionMetricsMany } from "@/lib/macroMetrics/merge";
import type { State, StateMetrics } from "@/lib/db/types";
import { getEraContext } from "@/lib/era/context";
import type { CountryId } from "@/lib/constants/countries";
import {
  calculateStateApproval,
  computeNationalAveragesFromMetrics,
  loadElectorateGroups,
  weightingFor,
  BASE_APPROVAL,
} from "@/lib/utils/governmentApproval";
import { NATIONAL_SCOPE_IDS } from "@/lib/constants/nationalScope";
import {
  isPoliticalApprovalCountry,
  loadPoliticalApprovalBases,
  type PoliticalApprovalBases,
} from "@/lib/politicalLegislation/politicalApprovalProvider";

/**
 * Get state government approval for a given state (0-100).
 * Used by the election engine to apply party strength modifier.
 * Returns BASE_APPROVAL (50) when state metrics or national averages are unavailable.
 */
export async function getStateApprovalForElection(stateId: string): Promise<number> {
  const map = await getAllStateApprovalsForElection();
  return map.get(stateId.toUpperCase()) ?? BASE_APPROVAL;
}

export interface GetAllStateApprovalsOptions {
  /**
   * When set, only loads states + metrics for these countries (full in-country
   * state lists for correct national averages). Skips other countries entirely.
   */
  countryIds?: CountryId[];
}

/**
 * Batch-load state approvals for all states (0-100 each).
 * Use when processing many states (e.g. presidential vote accumulation) to avoid N+1 queries.
 * Each state's approval is computed against its own country's national averages only,
 * preventing US and UK metrics from contaminating each other.
 */
export async function getAllStateApprovalsForElection(
  options?: GetAllStateApprovalsOptions
): Promise<Map<string, number>> {
  const db = await getDb();
  const countryIds = options?.countryIds;
  const stateFilter = countryIds && countryIds.length > 0 ? { countryId: { $in: countryIds } } : {};

  const allStates = await db
    .collection<State>("states")
    .find(stateFilter, { projection: { _id: 1, countryId: 1 } })
    .toArray();

  const stateIdsForMetrics = allStates.map((s) => s._id);
  let metricsFilter: Record<string, unknown> = {};
  if (countryIds && countryIds.length > 0) {
    metricsFilter =
      stateIdsForMetrics.length > 0 ? { _id: { $in: stateIdsForMetrics } } : { _id: { $in: [] } };
  }

  // SP5: merged two-store view.
  const allRawMetrics = await findMergedRegionMetricsMany(db, metricsFilter);

  // Exclude national-scope derived docs — they must not inflate country averages
  const stateOnlyMetrics = allRawMetrics.filter((m) => !NATIONAL_SCOPE_IDS.has(String(m._id)));

  // Map stateId → countryId
  const stateCountryMap = new Map(allStates.map((s) => [s._id, s.countryId]));

  // Group state metrics by country
  const metricsByCountry = new Map<string, StateMetrics[]>();
  for (const m of stateOnlyMetrics) {
    const cid = stateCountryMap.get(String(m._id));
    if (!cid) continue;
    const arr = metricsByCountry.get(cid) ?? [];
    arr.push(m);
    metricsByCountry.set(cid, arr);
  }

  // P6d: per-state electorate groups so election approval is the same
  // electorate-weighted value the turn snapshot stores (not ideology-blind).
  const demoFilter = countryIds && countryIds.length > 0 ? { countryId: { $in: countryIds } } : {};
  const [groupsByState, eraContext] = await Promise.all([
    loadElectorateGroups(db, demoFilter),
    // Era ruleset for approval scoring — same preset + era year the turn
    // snapshot uses, so election-time approval matches the displayed/stored value.
    getEraContext(db),
  ]);
  const { preset, year } = eraContext;

  // SP4: playable countries score from the hybrid political model (baseOverride);
  // named modifiers still evaluate on the surviving flat metrics.
  const politicalBasesByCountry = new Map<string, PoliticalApprovalBases | null>();
  for (const cid of metricsByCountry.keys()) {
    if (isPoliticalApprovalCountry(cid)) {
      politicalBasesByCountry.set(cid, await loadPoliticalApprovalBases(db, cid));
    }
  }

  // Compute per-country national averages, then approval for each state
  const result = new Map<string, number>();
  for (const [cid, countryMetrics] of metricsByCountry) {
    const nationalAverages = computeNationalAveragesFromMetrics(countryMetrics);
    const bases = politicalBasesByCountry.get(cid);
    for (const m of countryMetrics) {
      const id = (typeof m._id === "string" ? m._id : String(m._id)).toUpperCase();
      result.set(
        id,
        calculateStateApproval(
          m,
          nationalAverages,
          [],
          weightingFor(groupsByState, cid, String(m._id)),
          preset,
          year,
          isPoliticalApprovalCountry(cid)
            ? (bases?.byRegion.get(String(m._id)) ?? BASE_APPROVAL)
            : undefined
        )
      );
    }
  }

  return result;
}
