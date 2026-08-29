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
 * Inputs a caller may already hold, passed in to avoid re-querying them.
 *
 * `loadNationalApproval` fetches all four for its own purposes before it reaches
 * the fallback, so threading them through keeps its query count unchanged
 * whichever branch below ends up running.
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
  // SP5: merged two-store view. Scoped to the country for the same reason
  // `snapshotApprovalHistory` scopes it: state ids are not globally unique (DE HB
  // is Bremen, CN HB is Huabei), so an unscoped `$in` over them folds another
  // country's metrics into this one's national averages.
  const allMetrics = await findMergedRegionMetricsMany(db, {
    _id: { $in: allStates.map((s) => s._id) },
    countryId,
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

/**
 * Score a country's national approval live, with no `governmentApprovals`
 * document involved.
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
 * MAY RETURN A NON-FINITE NUMBER if a metric doc is malformed: `approvalComponent`
 * feeds a clamp that passes NaN straight through. Callers making a decision on the
 * result must check it — `NaN < threshold` is false, so a bare comparison fails
 * open. Unchanged from the behaviour this had inside `loadNationalApproval`.
 *
 * It does NOT write. A country scored here stays undocumented, so the snapshot
 * roster and its release path are unaffected.
 */
export async function recomputeNationalApproval(
  db: Db,
  countryId: CountryId,
  prefetched?: RecomputeInputs
): Promise<number> {
  // SP4: playable-country live fallback reads the hybrid political bases — never
  // the legacy metric scorer (spec §3 no-divergence rule). Checked BEFORE the
  // inputs are gathered because this branch reads none of them, and it is the only
  // branch a real country takes: `BOARD_COUNTRIES` currently covers every id in
  // `COUNTRY_ORDER`. Gathering first cost three discarded queries per call.
  if (isPoliticalApprovalCountry(countryId)) {
    const bases = await loadPoliticalApprovalBases(db, countryId);
    return bases?.national ?? BASE_APPROVAL;
  }

  const { allStates, allMetrics, nationalAverages, preset, year } =
    prefetched ?? (await gatherInputs(db, countryId));
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
