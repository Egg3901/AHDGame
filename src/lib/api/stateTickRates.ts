import type { Db } from "mongodb";
import { findMergedRegionMetrics } from "@/lib/macroMetrics/merge";
import { isMacroMetricPath } from "@/lib/macroMetrics/paths";
import type { State, LegislationType, CorporateSector, StateMetrics } from "@/lib/db/types";
import type { CountryId } from "@/lib/constants/countries";
import type { MetricCategoryId, StateMetricValue } from "@/lib/db/types/stateMetrics";
import type { StatePolicy } from "@/lib/db/types/statePolicy";
import { computeTickRates } from "@/lib/policyEffects";
import { MIRROR_CONTROLLED_METRIC_IDS } from "@/lib/metricEngine/fiscalMirror";
import { NATIONAL_SCOPE, getNationalDocId } from "@/lib/constants/nationalScope";
import {
  getFederalMultiplier,
  MAX_EFFECT_PER_LAW,
  getPolicyDecayFactor,
  effectiveIntensity,
  metricRangeScale,
  nationalDecayScope,
} from "@shared/constants/formulas";
import { getMetricDefinition } from "@/lib/constants/metricDefinitions";
import { optionIntensity, type IntensityOption } from "@/lib/legislature/optionIntensity";
import { computeIndependenceDesireDriftForRegion } from "@/lib/turn/independenceDesireDrift";
import type { PoliticalMetricsDoc } from "@/lib/db/types/politicalMetrics";
import type { PoliticalMetricId } from "@/lib/politicalMetrics/types";
import { politicalValueForLegacyMetric } from "@/lib/politicalLegislation/marginAdapter";
import { legacyValueFromPoliticalScore } from "@/lib/politicalMetrics/derive/legacyInversion";

const DECAY_FACTOR = getPolicyDecayFactor();

/**
 * Graded synthetic per-turn display rate for an effectTargetsWeighted target (Bug #0962).
 * Mirrors the decay path's magnitude (effectiveIntensity × rangeScale) so the metric-detail
 * forward projection matches what the turn actually applies. Center option → 0.
 */
export function syntheticTickRate(params: {
  options: IntensityOption[];
  optionIndex: number;
  weight: number;
  scopeMultiplier: number;
  isHigherBetter: boolean;
  minValue: number;
  maxValue: number;
  /** Current metric value — the operating scale for large-range metrics (Bug #0962). */
  referenceValue: number;
}): number {
  const {
    options,
    optionIndex,
    weight,
    scopeMultiplier,
    isHigherBetter,
    minValue,
    maxValue,
    referenceValue,
  } = params;
  const intensity = effectiveIntensity(optionIntensity(options, optionIndex));
  if (intensity === 0) return 0;
  const effectSign = isHigherBetter ? 1 : -1;
  // This projects the DECAY path, so use the normalized national decay scope (#0962)
  // to match what the turn applies — state laws (scope 1) are unchanged.
  return (
    intensity *
    weight *
    MAX_EFFECT_PER_LAW *
    effectSign *
    DECAY_FACTOR *
    nationalDecayScope(scopeMultiplier) *
    metricRangeScale(minValue, maxValue, referenceValue)
  );
}

/**
 * A legacy-unit reference value for one metric, resolved from a region's
 * political board. Null when the metric has no adapter row or no definition —
 * the caller then falls back to the legacy doc rather than inventing a scale.
 */
function boardReferenceValue(
  doc: PoliticalMetricsDoc,
  category: string,
  metricId: string
): number | null {
  const score = politicalValueForLegacyMetric(
    (doc.values ?? {}) as Record<PoliticalMetricId, number>,
    category,
    metricId
  );
  if (score == null) return null;
  return legacyValueFromPoliticalScore(category, metricId, score);
}

/**
 * Shared helper: compute per-turn tick rates from active state + national policies.
 * Used by both the state metrics API and the single-metric detail API.
 *
 * Priority:
 *  1. Admin-defined metricEffects on policyOptions (exact per-turn rates)
 *  2. Synthetic fallback derived from effectTargetsWeighted × decay factor
 *     (approximates what the decay engine implies per turn, for display only)
 */
export async function computeStateTickRates(
  db: Db,
  stateId: string,
  countryId: CountryId
): Promise<Record<string, Record<string, number>>> {
  try {
    const nationalScopeIds = Object.keys(NATIONAL_SCOPE);
    // Board regions resolve their POLITICAL reference values from the board;
    // the legacy doc supplies only the macro half for them (and everything for
    // a region with no board). Without this the reference falls back to
    // minValue, which for the currency-scaled metrics yields a ~0 rate and
    // silently blanks the projection.
    const politicalDoc = await db
      .collection<PoliticalMetricsDoc>("politicalMetrics")
      .findOne({ _id: stateId });
    const [allPolicyDocs, stateDoc, stateMetricsDoc] = await Promise.all([
      db
        .collection<StatePolicy>("statePolicies")
        .find({ stateId: { $in: [stateId, ...nationalScopeIds] } })
        .toArray(),
      db.collection<State>("states").findOne({ _id: stateId, countryId }),
      // Current metric values give the operating scale for large-range metrics (#0962).
      findMergedRegionMetrics(db, { _id: stateId }),
    ]);

    const statePolicies = allPolicyDocs.filter((p) => p.stateId === stateId);
    const nationalScopeId = stateDoc ? getNationalDocId(stateDoc.countryId) : undefined;
    const nationalPolicies = nationalScopeId
      ? allPolicyDocs.filter((p) => p.stateId === nationalScopeId)
      : [];

    // National policies apply their per-region share to each region. This per-country
    // multiplier scopes the TICK path (matching processStatePolicyEffects); the decay
    // projection re-normalizes it via nationalDecayScope inside syntheticTickRate (#0962).
    const nationalScopeMultiplier = getFederalMultiplier(countryId);
    const activePolicies = [
      ...statePolicies.map((p: StatePolicy) => ({ ...p, scopeMultiplier: 1.0 as number })),
      ...nationalPolicies.map((p: StatePolicy) => ({
        ...p,
        scopeMultiplier: nationalScopeMultiplier,
      })),
    ];

    const uniqueLegTypeIds = [
      ...new Set(activePolicies.map((p: StatePolicy) => p.legislationTypeId)),
    ];
    const legTypes = await db
      .collection<LegislationType>("legislationTypes")
      .find({ _id: { $in: uniqueLegTypeIds } })
      .toArray();
    const legTypeMap = new Map<string, LegislationType>(
      legTypes.map((lt) => [lt._id, lt] as [string, LegislationType])
    );

    // Primary: admin-defined metricEffects
    const rates = computeTickRates(activePolicies, legTypeMap);

    // Fallback: derive synthetic rates from effectTargetsWeighted for policies
    // that have no admin-defined metricEffects. This is display-only and matches
    // the approximate per-turn contribution implied by the decay engine.
    for (const policy of activePolicies) {
      if (!policy.effectDirection) continue; // Skip neutral policies

      const legType = legTypeMap.get(policy.legislationTypeId);
      if (!legType?.effectTargetsWeighted?.length) continue;

      // If the matched option already has metricEffects, admin defined them — skip
      const options = legType.policyOptions ?? [];
      const byId = options.findIndex((o) => o.id === policy.policyOptionId);
      const optIdx =
        byId !== -1 ? byId : options.findIndex((o) => o.effectDirection === policy.effectDirection);
      if (optIdx < 0) continue;
      if (options[optIdx]?.metricEffects?.length) continue;

      for (const target of legType.effectTargetsWeighted) {
        // 📊 budget-sync: computed fiscal metrics are mirror-owned — laws don't
        // move them, so exclude them from the display tick rates.
        if (MIRROR_CONTROLLED_METRIC_IDS.has(target.metricId)) continue;
        const metricDef = getMetricDefinition(
          target.metricCategoryId as MetricCategoryId,
          target.metricId
        );

        // Current value = the operating scale for large-range metrics (#0962). When the
        // state has no stored value, fall back to minValue (≈0 for the currency metrics),
        // which yields ~0 rate and is harmlessly skipped — never the midpoint, which for a
        // 10M-capped metric would re-introduce an absurd scale.
        const catValues = stateMetricsDoc?.[target.metricCategoryId as MetricCategoryId] as
          Record<string, StateMetricValue> | undefined;
        const storedValue = catValues?.[target.metricId]?.value;
        // Board first for political paths, then the legacy doc, then minValue.
        // `legacyValue` (the exact inverse) rather than a Bridge A band: this is
        // a display scale for arbitrary metrics, not an engine input with a
        // neutral to preserve, and almost none of them have authored bands.
        const boardValue =
          politicalDoc && !isMacroMetricPath(`${target.metricCategoryId}.${target.metricId}`)
            ? boardReferenceValue(politicalDoc, target.metricCategoryId, target.metricId)
            : null;
        const referenceValue =
          boardValue ??
          (typeof storedValue === "number" ? storedValue : (metricDef?.minValue ?? 0));

        // Graded synthetic rate (Bug #0962): matches the decay path's magnitude so
        // the forward projection reflects "Maximum" vs "Moderate" and scales for
        // large-range metrics.
        const rate = syntheticTickRate({
          options,
          optionIndex: optIdx,
          weight: target.weight,
          scopeMultiplier: policy.scopeMultiplier,
          isHigherBetter: metricDef?.isHigherBetter ?? true,
          minValue: metricDef?.minValue ?? 0,
          maxValue: metricDef?.maxValue ?? 100,
          referenceValue,
        });

        if (Math.abs(rate) < 0.0001) continue;

        const cat = target.metricCategoryId;
        if (!rates[cat]) rates[cat] = {};
        rates[cat][target.metricId] = (rates[cat][target.metricId] ?? 0) + rate;
      }
    }

    // UK independenceDesire is driven by its own dedicated turn-phase engine,
    // not by policy effects. Surface that engine's net per-turn delta as the
    // tickRate here so the metric detail page's 48-turn forward projection
    // matches the "Net drift next turn" line on the FM Devolution tab. Falls
    // back to no entry when the helper returns null (non-UK or non-devolved).
    const devolution = await computeIndependenceDesireDriftForRegion(db, stateId);
    if (devolution) {
      if (!rates.governance) rates.governance = {};
      rates.governance.independenceDesire =
        (rates.governance.independenceDesire ?? 0) + devolution.delta;
    }

    return rates;
  } catch {
    return {};
  }
}

/** A state's tick rates plus the fields needed to weight it into a national roll-up. */
export interface StateTickRateEntry {
  population: number;
  gdp: number;
  /** Whether the state has any corporate sectors (gates GDP-weighted metrics). */
  hasSectors: boolean;
  tickRates: Record<string, Record<string, number>>;
}

/**
 * Pure aggregation of per-state tick rates into national per-metric tick rates,
 * using the same weighting rules as {@link computeNationalMetricTickRate}:
 * population-weighted, except `economic.gdpGrowth` which is GDP-weighted and
 * excludes states with no corporate sectors. Metrics whose total weight is zero
 * are omitted.
 */
export function aggregateNationalTickRates(
  entries: StateTickRateEntry[]
): Record<string, Record<string, number>> {
  const weightedSum: Record<string, Record<string, number>> = {};
  const totalWeight: Record<string, Record<string, number>> = {};

  for (const entry of entries) {
    for (const [category, metrics] of Object.entries(entry.tickRates)) {
      for (const [metricId, rate] of Object.entries(metrics)) {
        if (typeof rate !== "number") continue;
        const useGdpWeight = category === "economic" && metricId === "gdpGrowth";
        const weight = useGdpWeight ? (entry.hasSectors ? entry.gdp : 0) : entry.population;
        if (weight <= 0) continue;

        (weightedSum[category] ??= {})[metricId] =
          (weightedSum[category]?.[metricId] ?? 0) + rate * weight;
        (totalWeight[category] ??= {})[metricId] =
          (totalWeight[category]?.[metricId] ?? 0) + weight;
      }
    }
  }

  const result: Record<string, Record<string, number>> = {};
  for (const [category, metrics] of Object.entries(weightedSum)) {
    for (const [metricId, sum] of Object.entries(metrics)) {
      const w = totalWeight[category]?.[metricId] ?? 0;
      if (w <= 0) continue;
      (result[category] ??= {})[metricId] = sum / w;
    }
  }
  return result;
}

/**
 * Compute national per-metric tick rates for an entire country in one pass:
 * each state's tick rates are computed once (vs. recomputing per metric), then
 * aggregated via {@link aggregateNationalTickRates}.
 */
export async function computeAllNationalMetricTickRates(
  db: Db,
  nationalStateId: string
): Promise<Record<string, Record<string, number>>> {
  const countryId = NATIONAL_SCOPE[nationalStateId];
  if (!countryId) return {};

  const [countryStates, sectorDocs] = await Promise.all([
    db.collection<State>("states").find({ countryId }).toArray(),
    db
      .collection<CorporateSector>("corporateSectors")
      .find({ countryId }, { projection: { stateId: 1 } })
      .toArray(),
  ]);
  if (countryStates.length === 0) return {};

  const statesWithSectors = new Set(sectorDocs.map((s) => s.stateId));
  const entries = await Promise.all(
    countryStates.map(async (state): Promise<StateTickRateEntry> => ({
      population: state.population ?? 0,
      gdp: state.gdp ?? 0,
      hasSectors: statesWithSectors.has(state._id),
      tickRates: await computeStateTickRates(db, state._id, state.countryId),
    }))
  );

  return aggregateNationalTickRates(entries);
}

/**
 * Aggregate per-state tick rates into a national metric tick rate using the same
 * weighting rules as computeNationalMetrics().
 */
export async function computeNationalMetricTickRate(
  db: Db,
  nationalStateId: string,
  category: MetricCategoryId,
  metricId: string
): Promise<number | undefined> {
  const countryId = NATIONAL_SCOPE[nationalStateId];
  if (!countryId) return undefined;

  const useGdpWeight = category === "economic" && metricId === "gdpGrowth";
  const [countryStates, sectorDocs] = await Promise.all([
    db.collection<State>("states").find({ countryId }).toArray(),
    useGdpWeight
      ? db
          .collection<CorporateSector>("corporateSectors")
          .find({}, { projection: { stateId: 1 } })
          .toArray()
      : Promise.resolve([] as CorporateSector[]),
  ]);

  if (countryStates.length === 0) return undefined;

  const statesWithSectors = new Set(sectorDocs.map((sector) => sector.stateId));
  const tickRatesByState = await Promise.all(
    countryStates.map(async (state) => ({
      state,
      tickRates: await computeStateTickRates(db, state._id, state.countryId),
    }))
  );

  let weightedSum = 0;
  let totalWeight = 0;

  for (const { state, tickRates } of tickRatesByState) {
    const rate = tickRates[category]?.[metricId];
    if (typeof rate !== "number") continue;

    const weight = useGdpWeight
      ? statesWithSectors.has(state._id)
        ? (state.gdp ?? 0)
        : 0
      : (state.population ?? 0);

    if (weight <= 0) continue;

    weightedSum += rate * weight;
    totalWeight += weight;
  }

  return totalWeight > 0 ? weightedSum / totalWeight : undefined;
}
