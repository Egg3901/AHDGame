import { getDb } from "@/lib/mongodb";
import { findMergedRegionMetricsMany } from "@/lib/macroMetrics/merge";
import type { State } from "@/lib/db/types";
import type { GovernmentApproval } from "@/lib/db/types/governmentApproval";
import { getEraContext } from "@/lib/era/context";
import {
  computeNationalAveragesFromMetrics,
  PUBLIC_EXPECTATIONS_MODIFIER,
} from "@/lib/utils/governmentApproval";
import { evaluateModifiers } from "@/lib/utils/approvalModifiers";
import {
  recomputeNationalApproval,
  recomputePoliticalNationalApproval,
  type RecomputeInputs,
} from "@/lib/country/recomputeNationalApproval";
import {
  isPoliticalApprovalCountry,
  type PoliticalApprovalBases,
} from "@/lib/politicalLegislation/politicalApprovalProvider";
import type { CountryId } from "@/lib/constants/countries";

export interface NationalApprovalData {
  governmentApproval: number;
  governmentApprovalBase: number;
  history: GovernmentApproval["history"];
  modifiers: ReturnType<typeof evaluateModifiers>;
}

/**
 * Compute the lightweight national approval payload for a country. Shared by the
 * GET route and server components so a page can seed its initial data with a
 * direct DB call instead of a client self-fetch through the CDN.
 */
export async function loadNationalApproval(
  countryId: CountryId,
  prefetched?: RecomputeInputs,
  bases?: PoliticalApprovalBases | null
): Promise<NationalApprovalData> {
  const db = await getDb();

  // governmentApprovals lookup is independent of stateMetrics — fetch in parallel
  const [allStates, approvalDoc] = await Promise.all([
    prefetched?.allStates ??
      db
        .collection<State>("states")
        .find({ countryId }, { projection: { _id: 1, population: 1 } })
        .toArray(),
    db.collection<GovernmentApproval>("governmentApprovals").findOne({ _id: countryId }),
  ]);
  const stateIds = allStates.map((s) => s._id);
  // SP5: merged two-store view. Scoped to the country like `snapshotApprovalHistory`
  // and `recomputeNationalApproval`: state ids collide across countries (DE HB is
  // Bremen, CN HB is Huabei), and an unscoped `$in` pulled the other country's
  // metrics into these national averages, which feed both the modifiers below and
  // the recompute the gate now shares.
  const allMetrics =
    prefetched?.allMetrics ??
    (await findMergedRegionMetricsMany(db, {
      _id: { $in: stateIds },
      countryId,
    }));
  const history = approvalDoc?.history ?? [];

  // National metric averages (cheap — just averaging the already-fetched docs).
  // Used for the named-condition modifiers (and for the live-approval fallback),
  // so the lightweight approval stat doesn't need the heavy national metrics
  // route (which also computes per-state tick rates) just to show conditions.
  const nationalAverages =
    allMetrics.length > 0 ? computeNationalAveragesFromMetrics(allMetrics) : {};
  // preset was previously omitted here, so national modifiers silently skipped
  // the era-1991 patches under the 1991 preset — threading era context fixes
  // both that and era-aware year drift in one go.
  const { preset, year } = prefetched ?? (await getEraContext(db));
  // Metric conditions are cheap to recompute from the averages already fetched.
  // The national providers — the address bump, org statements and the war block
  // — are not: they read conflicts, personnel and org state, which belongs in
  // the turn phase rather than a page render. They are stored by the snapshot
  // that produced this rating, so read them rather than recompute, and the
  // chips a reader shows are exactly the ones folded into the number above.
  const inputs = { allStates, allMetrics, nationalAverages, preset, year };
  const live = isPoliticalApprovalCountry(countryId)
    ? await recomputePoliticalNationalApproval(db, countryId, inputs, bases)
    : null;
  const modifiers = [
    ...(approvalDoc?.activeRegionalModifiers ??
      live?.regionalModifiers ??
      evaluateModifiers(nationalAverages, { countryId, preset, year })),
    ...(approvalDoc ? (approvalDoc.activeNationalModifiers ?? []) : [PUBLIC_EXPECTATIONS_MODIFIER]),
  ];
  const governmentApproval =
    approvalDoc?.approvalRating ??
    live?.approval ??
    (await recomputeNationalApproval(db, countryId, inputs));
  const governmentApprovalBase = approvalDoc?.approvalBase ?? live?.base ?? 50;

  return { governmentApproval, governmentApprovalBase, history, modifiers };
}
