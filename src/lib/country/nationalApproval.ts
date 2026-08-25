import { getDb } from "@/lib/mongodb";
import { findMergedRegionMetrics, findMergedRegionMetricsMany } from "@/lib/macroMetrics/merge";
import type { StateMetrics, State } from "@/lib/db/types";
import type { GovernmentApproval } from "@/lib/db/types/governmentApproval";
import { getEraContext } from "@/lib/era/context";
import {
  computeNationalAveragesFromMetrics,
  calculateStateApproval,
  calculateNationalApproval,
  loadElectorateGroups,
  weightingFor,
  BASE_APPROVAL,
} from "@/lib/utils/governmentApproval";
import { evaluateModifiers } from "@/lib/utils/approvalModifiers";
import {
  isPoliticalApprovalCountry,
  loadPoliticalApprovalBases,
} from "@/lib/politicalLegislation/politicalApprovalProvider";
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
  // SP5: merged two-store view.
  const allMetrics = await findMergedRegionMetricsMany(db, { _id: { $in: stateIds } });
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
  let governmentApproval = approvalDoc?.approvalRating;
  if (governmentApproval == null) {
    if (isPoliticalApprovalCountry(countryId)) {
      // SP4: playable-country live fallback reads the hybrid political bases —
      // never the legacy metric scorer (spec §3 no-divergence rule).
      const bases = await loadPoliticalApprovalBases(db, countryId);
      governmentApproval = bases?.national ?? BASE_APPROVAL;
    } else if (allMetrics.length === 0) {
      governmentApproval = BASE_APPROVAL;
    } else {
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
      governmentApproval = calculateNationalApproval(stateApprovals);
    }
  }

  return { governmentApproval: governmentApproval ?? BASE_APPROVAL, history, modifiers };
}
