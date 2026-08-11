/**
 * Per-turn drift engine for UK SCO/WAL/NIR Independence/Reunification Desire.
 *
 * Reads:
 *   - StateMetrics.governance.independenceDesire (current value)
 *   - governorOfficeState.devolutionPolicy (seated FM's policy choice)
 *   - StateMetrics across all UK states (for national averages → regional approval)
 *   - governmentApprovals (UK national / Westminster approval — last snapshot)
 *   - federalBudget.economicFactors.inflationRate (UK inflation, percent)
 *
 * Writes:
 *   - StateMetrics.governance.independenceDesire = { value, trend } for each
 *     SCO/WAL/NIR region. `value` is clamped to [0, 100]; `trend` is the
 *     per-turn delta so the office UI can show direction.
 *
 * Returns per-region attribution so the Devolution tab can break down which
 * driver contributed how much this turn. See
 * `docs/design/uk-devolution-policy.md` for the design rationale.
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
import type {
  IndependenceDesireDriftPerRegion,
  IndependenceDesireDriftResult,
} from "@/lib/governorOffice/devolution/independenceDesireDrift";
import { computeIndependenceDesireDriftSnapshot } from "@/lib/governorOffice/devolution/independenceDesireDrift";
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

  const ukStateIds = await db.collection<State>("states").distinct("_id", { countryId: "UK" });
  if (ukStateIds.length === 0) return null;

  // SP5: UK regions live on macroMetrics (independenceDesire hoisted top-level);
  // merge back to the legacy doc shape so downstream reads are unchanged.
  const ukMacroDocs = await db
    .collection<MacroMetricsDoc>("macroMetrics")
    .find({ _id: { $in: ukStateIds } })
    .toArray();
  const ukMetrics = ukMacroDocs
    .map((doc) => mergeRegionMetrics(doc))
    .filter((m): m is StateMetrics => m !== null);
  const metric = ukMetrics.find((m) => m._id === id);
  if (!metric) return null;

  const ukApprovalDoc = await db
    .collection<GovernmentApproval>("governmentApprovals")
    .findOne({ _id: "UK" });
  const nationalApproval = ukApprovalDoc?.approvalRating ?? DEFAULT_NATIONAL_APPROVAL;

  const ukBudget = await db
    .collection<FederalBudget>("federalBudget")
    .findOne({ _id: getNationalBudgetId("UK") });
  const inflationPercent = ukBudget?.economicFactors?.inflationRate ?? DEFAULT_INFLATION_PERCENT;

  const officeState = await db
    .collection<GovernorOfficeState>("governorOfficeState")
    .findOne({ countryId: "UK", stateId: id });
  const policy: DevolutionPolicy =
    (officeState?.devolutionPolicy as DevolutionPolicy | undefined) ?? DEFAULT_POLICY;

  const nationalAverages = computeNationalAveragesFromMetrics(ukMetrics);
  const [groupsByState, gameStateDoc] = await Promise.all([
    loadElectorateGroups(db, { countryId: "UK", _id: id }),
    db.collection<GameState>("gameState").findOne({ _id: "current" }),
  ]);
  const preset = gameStateDoc?.preset ?? DEFAULT_SEED_PRESET;
  // Live year for era-aware scoring; null while the flag is off (legacy path).
  const year = gameStateDoc?.eraSystemEnabled ? resolveGameYear(gameStateDoc) : null;
  // SP4: the UK drift driver reads the hybrid political base.
  const ukBases = await loadPoliticalApprovalBases(db, "UK");
  const regionalApproval = calculateStateApproval(
    metric,
    nationalAverages,
    [],
    weightingFor(groupsByState, "UK", id),
    preset,
    year,
    ukBases?.byRegion.get(id) ?? BASE_APPROVAL
  );
  const previous = metric.governance?.independenceDesire?.value ?? DEFAULT_INDEPENDENCE_DESIRE;

  const snapshot = computeIndependenceDesireDriftSnapshot({
    previous,
    policy,
    regionalApproval,
    nationalApproval,
    inflationPercent,
  });
  return { ...snapshot, previous };
}

export async function processIndependenceDesireDrift(
  db: Db,
  _currentTurn: number
): Promise<IndependenceDesireDriftResult | null> {
  // stateMetrics documents are not consistently tagged with countryId on UK
  // seeds — resolve UK state IDs via the `states` collection (same pattern
  // as snapshotApprovalHistory), then fetch metrics by _id.
  const ukStateIds = await db.collection<State>("states").distinct("_id", { countryId: "UK" });
  if (ukStateIds.length === 0) return null;

  // SP5: UK regions live on macroMetrics; merge back to the legacy doc shape.
  const ukMacroDocs = await db
    .collection<MacroMetricsDoc>("macroMetrics")
    .find({ _id: { $in: ukStateIds } })
    .toArray();
  const ukMetrics = ukMacroDocs
    .map((doc) => mergeRegionMetrics(doc))
    .filter((m): m is StateMetrics => m !== null);
  if (ukMetrics.length === 0) return null;

  const nationalAverages = computeNationalAveragesFromMetrics(ukMetrics);

  // National (Westminster) approval from the last snapshot. One-turn lag is
  // acceptable for a metric that moves at ≤0.12/turn.
  const ukApprovalDoc = await db
    .collection<GovernmentApproval>("governmentApprovals")
    .findOne({ _id: "UK" });
  const nationalApproval = ukApprovalDoc?.approvalRating ?? DEFAULT_NATIONAL_APPROVAL;

  // National inflation (annualised percent) from the UK budget doc.
  const ukBudget = await db
    .collection<FederalBudget>("federalBudget")
    .findOne({ _id: getNationalBudgetId("UK") });
  const inflationPercent = ukBudget?.economicFactors?.inflationRate ?? DEFAULT_INFLATION_PERCENT;

  // Pull the FM office-state rows for the three devolved regions so we know
  // each seated FM's Devolution Policy.
  const officeStates = await db
    .collection<GovernorOfficeState>("governorOfficeState")
    .find({ countryId: "UK", stateId: { $in: Array.from(UK_DEVOLUTION_REGIONS) } })
    .toArray();
  const policyByState = new Map<string, DevolutionPolicy>(
    officeStates
      .filter((o) => o.devolutionPolicy != null)
      .map((o) => [o.stateId, o.devolutionPolicy as DevolutionPolicy])
  );

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
  const writes: Array<{
    updateOne: {
      filter: { _id: string };
      update: {
        $set: {
          independenceDesire: { value: number; trend: number };
          lastUpdated: Date;
        };
      };
    };
  }> = [];

  const now = new Date();

  for (const stateId of UK_DEVOLUTION_REGIONS) {
    const metric = ukMetrics.find((m) => m._id === stateId);
    if (!metric) continue;

    const previous = metric.governance?.independenceDesire?.value ?? DEFAULT_INDEPENDENCE_DESIRE;
    const policy = policyByState.get(stateId) ?? DEFAULT_POLICY;
    const regionalApproval = calculateStateApproval(
      metric,
      nationalAverages,
      [],
      weightingFor(groupsByState, "UK", stateId),
      preset,
      year,
      ukBases?.byRegion.get(stateId) ?? BASE_APPROVAL
    );

    const { drivers, delta, next } = computeIndependenceDesireDriftSnapshot({
      previous,
      policy,
      regionalApproval,
      nationalApproval,
      inflationPercent,
    });

    perRegion.push({
      stateId,
      policy,
      previous,
      next,
      delta,
      drivers,
      inputs: { regionalApproval, nationalApproval, inflationPercent },
    });

    writes.push({
      updateOne: {
        filter: { _id: stateId },
        update: {
          $set: {
            independenceDesire: { value: next, trend: delta },
            lastUpdated: now,
          },
        },
      },
    });
  }

  if (writes.length > 0) {
    // SP5: independenceDesire lives on macroMetrics.
    await db.collection<StateMetrics>("macroMetrics").bulkWrite(writes);
  }

  return { regionsProcessed: writes.length, perRegion };
}
