import type { Db } from "mongodb";
import { findMergedRegionMetricsMany } from "@/lib/macroMetrics/merge";
import type { StateMetrics, State } from "@/lib/db/types";
import { getEraContext } from "@/lib/era/context";
import {
  computeNationalAveragesFromMetrics,
  calculateStateApproval,
  calculateNationalApproval,
  loadElectorateGroups,
  weightingFor,
  BASE_APPROVAL,
} from "@/lib/utils/governmentApproval";
import {
  isPoliticalApprovalCountry,
  loadPoliticalApprovalBases,
} from "@/lib/politicalLegislation/politicalApprovalProvider";
import type { CountryId } from "@/lib/constants/countries";

/**
 * Score a country's national approval from live state metrics, with no
 * `governmentApprovals` document involved.
 *
 * Lifted out of `loadNationalApproval`, which owned it as a page-render fallback.
 * It has a second caller now: the NPP war-entry gate, which has to judge the
 * public mood of a country that by construction has no stored rating. Only
 * `active` countries and current belligerents are snapshotted, so every other
 * country reads as having no document — and the gate used to treat that as 0%
 * approval rather than as "not measured yet".
 *
 * DELIBERATELY LIGHTER than the stored snapshot. The national providers — war
 * block, address bump, org statements, cabinet — read conflicts, personnel and
 * org state, which belongs in the turn phase and not here. A caller that has a
 * stored rating should prefer it; this is what to use when there is none.
 *
 * It does NOT write. A country scored here stays undocumented, so the snapshot
 * roster and its release path are unaffected.
 */

/**
 * Inputs a caller may already hold, passed in to avoid re-querying them.
 *
 * `loadNationalApproval` fetches all four for its own purposes before it reaches
 * the fallback, so threading them through keeps its query count unchanged.
 */
export interface RecomputeInputs {
  allStates: Pick<State, "_id" | "population">[];
  allMetrics: StateMetrics[];
  nationalAverages: ReturnType<typeof computeNationalAveragesFromMetrics>;
  preset: Awaited<ReturnType<typeof getEraContext>>["preset"];
  year: Awaited<ReturnType<typeof getEraContext>>["year"];
}

async function gatherInputs(db: Db, countryId: CountryId): Promise<RecomputeInputs> {
  const allStates = await db
    .collection<State>("states")
    .find({ countryId }, { projection: { _id: 1, population: 1 } })
    .toArray();
  // SP5: merged two-store view.
  const allMetrics = await findMergedRegionMetricsMany(db, {
    _id: { $in: allStates.map((s) => s._id) },
  });
  const { preset, year } = await getEraContext(db);
  return {
    allStates,
    allMetrics,
    nationalAverages: allMetrics.length > 0 ? computeNationalAveragesFromMetrics(allMetrics) : {},
    preset,
    year,
  };
}

export async function recomputeNationalApproval(
  db: Db,
  countryId: CountryId,
  prefetched?: RecomputeInputs
): Promise<number> {
  const { allStates, allMetrics, nationalAverages, preset, year } =
    prefetched ?? (await gatherInputs(db, countryId));

  if (isPoliticalApprovalCountry(countryId)) {
    // SP4: playable-country live fallback reads the hybrid political bases —
    // never the legacy metric scorer (spec §3 no-divergence rule).
    const bases = await loadPoliticalApprovalBases(db, countryId);
    return bases?.national ?? BASE_APPROVAL;
  }
  if (allMetrics.length === 0) return BASE_APPROVAL;

  const stateIds = allStates.map((s) => s._id);
  const statePopMap = new Map(allStates.map((s) => [s._id, s.population ?? 0]));
  const groupsByState = await loadElectorateGroups(db, { _id: { $in: stateIds }, countryId });
  const stateApprovals = allMetrics.map((m) => ({
    stateId: m._id,
    approval: calculateStateApproval(
      m,
      nationalAverages,
      [],
      weightingFor(groupsByState, countryId, String(m._id)),
      preset,
      year
    ),
    population: statePopMap.get(m._id) ?? 0,
  }));
  return calculateNationalApproval(stateApprovals);
}
