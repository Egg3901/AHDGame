/**
 * Independence and Reunification Desire previews load both governments' stances,
 * approval and inflation. loadIndependenceDesireSnapshots supplies the turn engine
 * and both office dashboards with the same regional calculations.
 */
import type { Db } from "mongodb";
import type { FederalBudget, GameState, State, StateMetrics } from "@/lib/db/types";
import { resolveGameYear } from "@/lib/era/era";
import type { DevolutionPolicy, GovernorOfficeState } from "@/lib/db/types/governorOfficeState";
import type { GovernmentApproval } from "@/lib/db/types/governmentApproval";
import { UK_DEVOLUTION_REGIONS } from "@/lib/constants/devolution";
import {
  BASE_APPROVAL,
  calculateStateApproval,
  computeNationalAveragesFromMetrics,
  loadElectorateGroups,
  weightingFor,
} from "@/lib/utils/governmentApproval";
import { loadPoliticalApprovalBases } from "@/lib/politicalLegislation/politicalApprovalProvider";
import { mergeRegionMetrics } from "@/lib/macroMetrics/merge";
import type { MacroMetricsDoc } from "@/lib/db/types/macroMetrics";
import { getNationalBudgetId } from "@/lib/bonds/sovereign";
import type { IndependenceDesireDriftPerRegion } from "@/lib/governorOffice/devolution/independenceDesireDrift";
import { computeIndependenceDesireDriftSnapshot } from "@/lib/governorOffice/devolution/independenceDesireDrift";
import { getNationalStateId } from "@/lib/policy/nationalStateId";
import { resolveWestminsterPolicy } from "@/lib/governorOffice/devolution/rules";
import { DEFAULT_SEED_PRESET } from "@/lib/constants/seedPreset";

// Pure surface (driver types + snapshot compute) lives in the domain layer;
// re-exported here so existing importers keep working.
export * from "@/lib/governorOffice/devolution/independenceDesireDrift";

const DEFAULT_POLICY: DevolutionPolicy = "pro";
/** Fallback when the UK national approval snapshot doesn't exist yet (turn 1). */
const DEFAULT_NATIONAL_APPROVAL = 50;
/** Fallback when independenceDesire hasn't been seeded for a region yet. */
const DEFAULT_INDEPENDENCE_DESIRE = 50;
/** Fallback when UK federalBudget hasn't been written yet. 2% sits in the
 *  inflationDrift mid-band → 0 contribution. */
const DEFAULT_INFLATION_PERCENT = 2;

/**
 * Compute the next-turn drift snapshot for a single UK devolved region
 * (SCO/WAL/NIR) without writing to the DB. Same inputs the per-turn engine
 * would use — pulled fresh from the live collections. Returns null when the
 * state isn't a UK devolution region or its metric doc is missing.
 *
 * Used by the metric-detail API to surface the drift's net delta as a
 * tickRate on `governance.independenceDesire`, so the 48-turn forward
 * projection chart matches the Devolution tab's "Net drift next turn" line.
 */
export async function computeIndependenceDesireDriftForRegion(
  db: Db,
  stateId: string
): Promise<{
  drivers: IndependenceDesireDriftPerRegion["drivers"];
  delta: number;
  next: number;
  previous: number;
} | null> {
  const id = stateId.toUpperCase();
  if (!UK_DEVOLUTION_REGIONS.has(id)) return null;
  return (await loadIndependenceDesireSnapshots(db)).find((row) => row.stateId === id) ?? null;
}

/** Read all three regional previews in one batch, shared by the engine and dashboards. */
export async function loadIndependenceDesireSnapshots(
  db: Db
): Promise<IndependenceDesireDriftPerRegion[]> {
  // stateMetrics documents are not consistently tagged with countryId on UK
  // seeds — resolve UK state IDs via the `states` collection (same pattern
  // as snapshotApprovalHistory), then fetch metrics by _id.
  const ukStateIds = await db.collection<State>("states").distinct("_id", { countryId: "UK" });
  if (ukStateIds.length === 0) return [];

  // SP5: UK regions live on macroMetrics; merge back to the legacy doc shape.
  const ukMacroDocs = await db
    .collection<MacroMetricsDoc>("macroMetrics")
    .find({ _id: { $in: ukStateIds } })
    .toArray();
  const ukMetrics = ukMacroDocs
    .map((doc) => mergeRegionMetrics(doc))
    .filter((m): m is StateMetrics => m !== null);
  if (ukMetrics.length === 0) return [];

  const nationalAverages = computeNationalAveragesFromMetrics(ukMetrics);

  // National (Westminster) approval from the last snapshot. One-turn lag is
  // acceptable for a slowly changing constitutional preference.
  const ukApprovalDoc = await db
    .collection<GovernmentApproval>("governmentApprovals")
    .findOne({ _id: "UK" });
  const nationalApproval = ukApprovalDoc?.approvalRating ?? DEFAULT_NATIONAL_APPROVAL;

  // National inflation (annualised percent) from the UK budget doc.
  const ukBudget = await db
    .collection<FederalBudget>("federalBudget")
    .findOne({ _id: getNationalBudgetId("UK") });
  const inflationPercent = ukBudget?.economicFactors?.inflationRate ?? DEFAULT_INFLATION_PERCENT;

  // Read the regional and Westminster policies together, without another round trip.
  const officeStates = await db
    .collection<GovernorOfficeState>("governorOfficeState")
    .find({
      countryId: "UK",
      stateId: { $in: [...UK_DEVOLUTION_REGIONS, getNationalStateId("UK")] },
    })
    .project<Pick<GovernorOfficeState, "stateId" | "devolutionPolicy" | "westminsterStances">>({
      _id: 0,
      stateId: 1,
      devolutionPolicy: 1,
      westminsterStances: 1,
    })
    .toArray();
  const policyByState = new Map<string, DevolutionPolicy>(
    officeStates
      .filter((o) => o.devolutionPolicy != null)
      .map((o) => [o.stateId, o.devolutionPolicy as DevolutionPolicy])
  );

  const nationalOffice = officeStates.find((o) => o.stateId === getNationalStateId("UK"));

  // P6d: electorate-weighted regional approval (same value the snapshot stores).
  const [groupsByState, gameStateDoc] = await Promise.all([
    loadElectorateGroups(db, { countryId: "UK" }),
    db.collection<GameState>("gameState").findOne({ _id: "current" }),
  ]);
  const preset = gameStateDoc?.preset ?? DEFAULT_SEED_PRESET;
  // Live year for era-aware scoring; null while the flag is off (legacy path).
  const year = gameStateDoc?.eraSystemEnabled ? resolveGameYear(gameStateDoc) : null;
  // SP4: hybrid political bases once for the whole drift pass.
  const ukBases = await loadPoliticalApprovalBases(db, "UK");

  const perRegion: IndependenceDesireDriftPerRegion[] = [];
  for (const stateId of UK_DEVOLUTION_REGIONS) {
    const metric = ukMetrics.find((m) => m._id === stateId);
    if (!metric) continue;

    const previous = metric.governance?.independenceDesire?.value ?? DEFAULT_INDEPENDENCE_DESIRE;
    const policy = policyByState.get(stateId) ?? DEFAULT_POLICY;
    const westminsterPolicy = resolveWestminsterPolicy(
      nationalOffice?.westminsterStances?.[stateId as "SCO" | "WAL" | "NIR"]?.policy
    );
    const regionalApproval = calculateStateApproval(
      metric,
      nationalAverages,
      [],
      weightingFor(groupsByState, "UK", stateId),
      preset,
      year,
      ukBases?.byRegion.get(stateId) ?? BASE_APPROVAL,
      ukBases?.modifiersByRegion?.get(stateId)
    );

    const { drivers, delta, next } = computeIndependenceDesireDriftSnapshot({
      previous,
      policy,
      westminsterPolicy,
      regionalApproval,
      nationalApproval,
      inflationPercent,
    });

    perRegion.push({
      stateId,
      policy,
      westminsterPolicy,
      trend: metric.governance?.independenceDesire?.trend ?? 0,
      previous,
      next,
      delta,
      drivers,
      inputs: { regionalApproval, nationalApproval, inflationPercent },
    });
  }
  return perRegion;
}
