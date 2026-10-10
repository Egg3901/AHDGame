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
  buildFlatMetrics,
  PUBLIC_EXPECTATIONS_MODIFIER,
} from "@/lib/utils/governmentApproval";
import { applyModifiers, type ActiveModifier } from "@/lib/utils/approvalModifiers";
import {
  isPoliticalApprovalCountry,
  loadPoliticalApprovalBases,
} from "@/lib/politicalLegislation/politicalApprovalProvider";
import { nationalApprovalFromRegions } from "./rules/nationalApproval";
import type { PoliticalApprovalBases } from "@/lib/politicalLegislation/politicalApprovalProvider";
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
 * `expectations` is the public expectations modifier to apply. It defaults to the
 * full-strength drag, which is the rule for a head of government whose start turn
 * is unknown. Callers holding a stored tenure pass `publicExpectationsModifier(...)`.
 *
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
  prefetched?: RecomputeInputs,
  expectations: ActiveModifier = PUBLIC_EXPECTATIONS_MODIFIER
): Promise<number> {
  if (isPoliticalApprovalCountry(countryId, true)) {
    return (
      await recomputePoliticalNationalApproval(db, countryId, prefetched, undefined, expectations)
    ).approval;
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
  return applyModifiers(calculateNationalApproval(stateApprovals), [expectations]);
}

/** Shared fresh-world result for cards and metrics. No averaged-threshold approximation. */
export async function recomputePoliticalNationalApproval(
  db: Db,
  countryId: CountryId,
  prefetched?: RecomputeInputs,
  prefetchedBases?: PoliticalApprovalBases | null,
  expectations: ActiveModifier = PUBLIC_EXPECTATIONS_MODIFIER
): Promise<ReturnType<typeof nationalApprovalFromRegions>> {
  const [inputs, bases] = await Promise.all([
    prefetched ?? gatherInputs(db, countryId),
    prefetchedBases === undefined ? loadPoliticalApprovalBases(db, countryId) : prefetchedBases,
  ]);
  const populations = new Map(
    inputs.allStates.map((state) => [String(state._id), state.population ?? 0])
  );
  return nationalApprovalFromRegions(
    inputs.allMetrics.map((metrics) => ({
      base: bases?.byRegion.get(String(metrics._id)) ?? BASE_APPROVAL,
      population: populations.get(String(metrics._id)) ?? 0,
      metrics: buildFlatMetrics(metrics),
      modifiers: bases?.modifiersByRegion?.get(String(metrics._id)),
    })),
    { countryId, preset: inputs.preset, year: inputs.year },
    [expectations]
  );
}
