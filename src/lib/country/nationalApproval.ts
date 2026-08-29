import { getDb } from "@/lib/mongodb";
import { findMergedRegionMetricsMany } from "@/lib/macroMetrics/merge";
import type { State } from "@/lib/db/types";
import type { GovernmentApproval } from "@/lib/db/types/governmentApproval";
import { getEraContext } from "@/lib/era/context";
import { computeNationalAveragesFromMetrics } from "@/lib/utils/governmentApproval";
import { evaluateModifiers } from "@/lib/utils/approvalModifiers";
import { recomputeNationalApproval } from "@/lib/country/recomputeNationalApproval";
import type { CountryId } from "@/lib/constants/countries";

export interface NationalApprovalData {
  governmentApproval: number;
  history: GovernmentApproval["history"];
  modifiers: ReturnType<typeof evaluateModifiers>;
}

/**
 * Compute the lightweight national approval payload for a country. Shared by the
 * GET route and server components so a page can seed its initial data with a
 * direct DB call instead of a client self-fetch through the CDN.
 */
export async function loadNationalApproval(countryId: CountryId): Promise<NationalApprovalData> {
  const db = await getDb();

  // governmentApprovals lookup is independent of stateMetrics — fetch in parallel
  const [allStates, approvalDoc] = await Promise.all([
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
  const allMetrics = await findMergedRegionMetricsMany(db, {
    _id: { $in: stateIds },
    countryId,
  });
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
  const { preset, year } = await getEraContext(db);
  // Metric conditions are cheap to recompute from the averages already fetched.
  // The national providers — the address bump, org statements and the war block
  // — are not: they read conflicts, personnel and org state, which belongs in
  // the turn phase rather than a page render. They are stored by the snapshot
  // that produced this rating, so read them rather than recompute, and the
  // chips a reader shows are exactly the ones folded into the number above.
  const modifiers = [
    ...evaluateModifiers(nationalAverages, { countryId, preset, year }),
    ...(approvalDoc?.activeNationalModifiers ?? []),
  ];

  // Canonical approval is the value the per-turn snapshot stored in
  // governmentApprovals (includes national address/cabinet adjustments and
  // matches the history chart, the Executive page, and the metrics masthead).
  // A live recompute is only a fallback for DBs that have no snapshot yet.
  // The inputs are handed over rather than re-fetched: everything the recompute
  // needs was already read above for the modifiers, so this path costs the same
  // queries it always did.
  const governmentApproval =
    approvalDoc?.approvalRating ??
    (await recomputeNationalApproval(db, countryId, {
      allStates,
      allMetrics,
      nationalAverages,
      preset,
      year,
    }));

  return { governmentApproval, history, modifiers };
}
