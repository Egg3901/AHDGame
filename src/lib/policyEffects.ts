/**
 * Policy Effects Processing Module
 *
 * Processes active policies for states and applies their effects to state metrics
 * using exponential decay toward target values.
 *
 * KEY DESIGN DECISIONS:
 *
 * 1. Federal multiplier (country-aware): US federal policies apply at 1/50 strength
 *    per state; UK national policies apply at 1/12 strength per region. The multiplier
 *    is chosen so the sum of per-region effects equals the intended national total.
 *    Prevents a single federal bill from dominating state/region metrics.
 *
 * 2. Exponential decay toward target: Policies don't apply flat deltas; they move
 *    metrics toward a target value with exponential decay. This creates smooth,
 *    asymptotic change rather than jarring step functions.
 *
 * 3. Per-turn additive effects: policyOptions[].metricEffects apply direct additive
 *    changes each turn the policy is active. Scaled for ~10-year full reversal:
 *    extreme ≈ ±0.06/turn, center = 0.
 *
 * 4. Natural metric decay: All metrics decay naturally toward baseline at 0.25%/turn
 *    when no active policy is pushing them. This prevents metrics from permanently
 *    deviating after extreme legislation passes and expires.
 */

import type { Db } from "mongodb";
import type { StatePolicy, StateMetricBaseline } from "@/lib/db/types/statePolicy";
import type { StateMetrics, MetricCategoryId, StateMetricValue } from "@/lib/db/types/stateMetrics";
import type {
  LegislationType,
  EffectTargetWeighted,
  PolicyOptionMetricEffect,
} from "@/lib/db/types/legislation";
import type { State } from "@/lib/db/types/state";
import type { GameState } from "@/lib/db/types/gameState";
import {
  getFederalMultiplier,
  applyPolicyDecay,
  calculatePolicyContribution,
  applyHalfLifeDecay,
  effectiveIntensity,
  metricRangeScale,
  nationalDecayScope,
} from "@shared/constants/formulas";
import { optionIntensity } from "@/lib/legislature/optionIntensity";
import { getNationalDocId } from "@/lib/constants/nationalScope";
import { metricCategories, getMetricDefinition } from "@/lib/constants/metricDefinitions";
import { MIRROR_CONTROLLED_METRIC_IDS } from "@/lib/metricEngine/fiscalMirror";
import { DRIFT_OWNED_METRICS } from "@/lib/constants/devolution";
import { isPoliticalApprovalCountry } from "@/lib/politicalLegislation/politicalApprovalProvider";
import { isMetricActive, getEraBand } from "@/lib/era/metricCatalog";
import { resolveGameYear } from "@/lib/era/era";
import { findMergedRegionMetrics, findMergedRegionMetricsMany } from "@/lib/macroMetrics/merge";
import { isMacroMetricPath } from "@/lib/macroMetrics/paths";

/**
 * Map of legislation type IDs to their documents
 */
export type LegislationTypeMap = Map<string, LegislationType>;

/**
 * Represents an active policy with its scope multiplier
 */
export interface ActivePolicy extends StatePolicy {
  scopeMultiplier: number;
}

/**
 * Get all active policies for a state, including federal policies
 * @param db - MongoDB database instance
 * @param stateId - The state ID (e.g., "CA", "TX")
 * @returns Array of active policies with scope multipliers
 */
export async function getActivePoliciesForState(
  db: Db,
  stateId: string,
  countryId: string = "US"
): Promise<ActivePolicy[]> {
  const statePolicies = db.collection<StatePolicy>("statePolicies");

  // Get state-specific policies
  const statePoliciesArray = await statePolicies.find({ stateId }).toArray();

  // Get the appropriate national-scope policies based on country
  const nationalScopeId = getNationalDocId(
    countryId as import("@/lib/constants/countries").CountryId
  );
  const nationalPoliciesArray = await statePolicies.find({ stateId: nationalScopeId }).toArray();

  // Add scope multipliers
  const stateWithMultiplier: ActivePolicy[] = statePoliciesArray.map((policy) => ({
    ...policy,
    scopeMultiplier: 1.0,
  }));

  const nationalWithMultiplier: ActivePolicy[] = nationalPoliciesArray.map((policy) => ({
    ...policy,
    scopeMultiplier: getFederalMultiplier(countryId),
  }));

  return [...stateWithMultiplier, ...nationalWithMultiplier];
}

/**
 * Get the baseline value for a specific metric in a state from a pre-fetched baseline document
 * @param baselineDoc - The pre-fetched baseline document (or null if not found)
 * @param categoryId - The metric category (e.g., "economic")
 * @param metricId - The metric ID (e.g., "unemploymentRate")
 * @returns The baseline value (defaults to 50 if not found)
 */
export function getMetricBaselineFromDoc(
  baselineDoc: StateMetricBaseline | null,
  categoryId: MetricCategoryId,
  metricId: string
): number {
  const value = baselineDoc?.baselines?.[categoryId]?.[metricId];
  if (value === undefined || value === null) {
    return 50; // Default baseline
  }

  return value;
}

/**
 * Get the baseline value for a specific metric in a state
 * @param db - MongoDB database instance
 * @param stateId - The state ID
 * @param categoryId - The metric category (e.g., "economic")
 * @param metricId - The metric ID (e.g., "unemploymentRate")
 * @returns The baseline value (defaults to 50 if not found)
 * @deprecated Use getMetricBaselineFromDoc with a pre-fetched baseline document for better performance
 */
export async function getMetricBaseline(
  db: Db,
  stateId: string,
  categoryId: MetricCategoryId,
  metricId: string
): Promise<number> {
  const stateBaselines = db.collection<StateMetricBaseline>("stateBaselines");

  const baselineDoc = await stateBaselines.findOne({ _id: stateId });

  return getMetricBaselineFromDoc(baselineDoc, categoryId, metricId);
}

/**
 * Calculate the target value for a metric based on active policies
 * @param baselineDoc - Pre-fetched baseline document for the state
 * @param categoryId - The metric category
 * @param metricId - The metric ID
 * @param policies - Array of active policies
 * @param legTypeMap - Pre-fetched map of legislation type IDs to documents
 * @param currentTurn - Current game turn (for time-based effect decay)
 * @returns The calculated target value
 */
export function calculateMetricTarget(
  baselineDoc: StateMetricBaseline | null,
  categoryId: MetricCategoryId,
  metricId: string,
  policies: ActivePolicy[],
  legTypeMap: LegislationTypeMap,
  currentTurn: number = 0,
  currentValue?: number,
  countryId?: string,
  eraYear: number | null = null
): number {
  // Get metric definition to determine if higher is better and the value range.
  const metricDef = getMetricDefinition(categoryId, metricId);

  // Use currentValue as the effective baseline only for large-range metrics
  // (maxValue > 100, e.g. educationSpending ~$13,500, testPerformance up to 150).
  // The seeded stateBaselines for these metrics are 40-60 placeholders — using them
  // would pull large absolute values DOWN toward 50, inverting bill effects.
  // For percentage/index metrics (maxValue ≤ 100, e.g. publicTrust, transparency),
  // the seeded baseline is a meaningful anchor and should be respected.
  const useCurrentValueAsBaseline =
    currentValue !== undefined && (metricDef?.maxValue ?? 100) > 100;
  let baseline = useCurrentValueAsBaseline
    ? currentValue
    : getMetricBaselineFromDoc(baselineDoc, categoryId, metricId);
  const isHigherBetter = metricDef?.isHigherBetter ?? true;
  // Era-aware resting baseline: a WINDOWED metric whose frozen seed is out-of-era
  // (beyond its era-band worst at the live year) would otherwise rest at an
  // anachronistic pre-window level (e.g. a 1991 world's broadband seed of 0 in
  // 2010). Decay toward the era-band `best` so it settles at the era-normal.
  // Non-windowed metrics (getEraBand → null), in-band seeds, large-range metrics,
  // and flag-off (eraYear === null) are all untouched — legacy behavior.
  // DIRECTION-AWARE (#3238): "out of era" means the seed sits on the WRONG side
  // of the band's worst bound. The old direction-blind `baseline < band.worst`
  // was satisfied by any GOOD value on a lower-is-better metric (being below
  // "worst" is being good), silently rewriting decay targets to band.best —
  // e.g. povertyRate baselines were dragged toward the era BEST in flag-on
  // worlds (#2547-class free-improvement drift).
  if (eraYear != null && !useCurrentValueAsBaseline) {
    const band = getEraBand(metricId, countryId, eraYear);
    const outOfEra =
      band != null && (isHigherBetter ? baseline < band.worst : baseline > band.worst);
    if (outOfEra) {
      baseline = band.best;
    }
  }
  // Per-metric magnitude scale (Bug #0962 #1): policy effects are 0-100-index sized,
  // so a large-range metric (educationSpending ~£13k, capped at 10M) needs the contribution
  // scaled to its OPERATING value or the movement is imperceptible. `baseline` is that value
  // (currentValue for large metrics via useCurrentValueAsBaseline). Index metrics → 1.0.
  const rangeScale = metricRangeScale(
    metricDef?.minValue ?? 0,
    metricDef?.maxValue ?? 100,
    baseline
  );

  // Sum contributions from all policies
  let totalContribution = 0;

  for (const policy of policies) {
    // Look up the legislation type from pre-fetched map
    const legType = legTypeMap.get(policy.legislationTypeId);

    if (!legType) continue;

    // Graded intensity from the option ladder (Bug #0962): "Maximum" beats "Moderate"
    // even on the same side. Falls back to the 3-valued effectDirection sign only when
    // the option can't be resolved. Center option → 0 → no-op (unchanged for neutral laws).
    const options = legType.policyOptions ?? [];
    const byId = options.findIndex((o) => o.id === policy.policyOptionId);
    const optIdx =
      byId !== -1 ? byId : options.findIndex((o) => o.effectDirection === policy.effectDirection);
    const intensity =
      optIdx >= 0 ? optionIntensity(options, optIdx) : Math.sign(policy.effectDirection);
    const strength = effectiveIntensity(intensity) * 3; // calculatePolicyContribution normalizes /3
    // Normalized decay scope (#0962): national laws use a region-count-independent
    // multiplier so their decay effect is uniform across countries; state laws (scope 1)
    // are unchanged. The tick path (computeTickRates) keeps the per-country multiplier.
    const decayScope = nationalDecayScope(policy.scopeMultiplier);

    // Check for weighted effect targets (preferred)
    if (legType.effectTargetsWeighted && legType.effectTargetsWeighted.length > 0) {
      // Find matching targets
      const matchingTargets = legType.effectTargetsWeighted.filter(
        (target: EffectTargetWeighted) =>
          target.metricCategoryId === categoryId && target.metricId === metricId
      );

      for (const target of matchingTargets) {
        let contribution =
          calculatePolicyContribution(strength, target.weight, decayScope, isHigherBetter) *
          rangeScale;

        // Apply time-based decay if this target has an adjustment half-life
        // This models economic adaptation: e.g., defense cuts initially hurt GDP but
        // the economy adjusts over time, reducing the negative effect
        if (target.adjustmentHalfLife && policy.enactedTurn !== undefined && currentTurn > 0) {
          const turnsElapsed = Math.max(0, currentTurn - policy.enactedTurn);
          const decayFactor = applyHalfLifeDecay(1, turnsElapsed, target.adjustmentHalfLife);
          contribution *= decayFactor;
        }

        totalContribution += contribution;
      }
    } else if (legType.effectTarget) {
      // Fallback to legacy single effect target
      if (
        legType.effectTarget.metricCategoryId === categoryId &&
        legType.effectTarget.metricId === metricId
      ) {
        // Legacy targets have implicit weight of 1.0
        const contribution =
          calculatePolicyContribution(strength, 1.0, decayScope, isHigherBetter) * rangeScale;
        totalContribution += contribution;
      }
    }
  }

  // Calculate target as baseline + total contribution
  const target = baseline + totalContribution;

  // Clamp to metric-specific bounds (default 0-100)
  const minVal = metricDef?.minValue ?? 0;
  const maxVal = metricDef?.maxValue ?? 100;
  return Math.max(minVal, Math.min(maxVal, target));
}

/**
 * Compute direct per-turn tick rates for all metrics from active policies' metricEffects.
 * Returns a nested map: { [categoryId]: { [metricId]: totalRatePerTurn } }
 * Used both for applying effects each turn and for tooltip display.
 */
export function computeTickRates(
  policies: ActivePolicy[],
  legTypeMap: LegislationTypeMap,
  countryId?: string,
  year: number | null = null
): Record<string, Record<string, number>> {
  const rates: Record<string, Record<string, number>> = {};

  for (const policy of policies) {
    const legType = legTypeMap.get(policy.legislationTypeId);
    if (!legType?.policyOptions?.length) continue;

    // Find the active policy option by policyOptionId (exact match), fall back to effectDirection
    const policyOption =
      legType.policyOptions.find((opt) => opt.id === policy.policyOptionId) ??
      legType.policyOptions.find((opt) => opt.effectDirection === policy.effectDirection);
    if (!policyOption?.metricEffects?.length) continue;

    for (const effect of policyOption.metricEffects as PolicyOptionMetricEffect[]) {
      const { category, metricId, ratePerTurn } = effect;
      // 📊 budget-sync chokepoint: computed fiscal metrics are owned by the budget
      // mirror — the policy layer never writes to them (also keeps them out of the
      // effect tooltips this map feeds).
      if (MIRROR_CONTROLLED_METRIC_IDS.has(metricId)) continue;
      // Era gate: a law cannot move a metric that does not exist yet. Null year
      // (flag off / legacy) ⇒ isMetricActive true ⇒ byte-identical behavior.
      if (!isMetricActive(metricId, countryId, year)) continue;
      if (!rates[category]) rates[category] = {};
      rates[category][metricId] =
        (rates[category][metricId] ?? 0) + ratePerTurn * policy.scopeMultiplier;
    }
  }

  return rates;
}

/**
 * Process all metrics for a state, applying exponential decay toward targets
 * @param db - MongoDB database instance
 * @param stateId - The state ID
 * @param federalPolicies - Pre-fetched federal policies with scope multipliers
 * @param legTypeMap - Pre-fetched map of legislation type IDs to documents
 * @param currentTurn - Current game turn (for time-based effect decay)
 */
export async function processStateMetrics(
  db: Db,
  stateId: string,
  federalPolicies: ActivePolicy[],
  legTypeMap: LegislationTypeMap,
  currentTurn: number = 0
): Promise<void> {
  const statePoliciesCollection = db.collection<StatePolicy>("statePolicies");
  const stateBaselinesCollection = db.collection<StateMetricBaseline>("stateBaselines");

  // Get state-specific policies (federal policies are passed in)
  const statePoliciesArray = await statePoliciesCollection.find({ stateId }).toArray();

  const stateWithMultiplier: ActivePolicy[] = statePoliciesArray.map((policy) => ({
    ...policy,
    scopeMultiplier: 1.0,
  }));

  // Combine state and federal policies
  const policies = [...stateWithMultiplier, ...federalPolicies];

  // Get current state metrics (SP5: merged two-store view) and baseline in parallel
  const [currentMetrics, baselineDoc] = await Promise.all([
    findMergedRegionMetrics(db, { _id: stateId }),
    stateBaselinesCollection.findOne({ _id: stateId }),
  ]);

  if (!currentMetrics) {
    console.warn(`No metrics document found for state ${stateId}`);
    return;
  }

  // Build update object
  const updates: Record<string, number> = {};
  const MIN_CHANGE_THRESHOLD = 0.001;

  // Process each category and metric
  for (const category of metricCategories) {
    const categoryId = category.id as MetricCategoryId;
    const categoryData = currentMetrics[categoryId];

    if (!categoryData || typeof categoryData !== "object") continue;

    for (const metric of category.metrics) {
      const metricId = metric.id;
      // 📊 budget-sync chokepoint: the computed fiscal metrics are a pure readout
      // owned by the budget mirror; the policy layer must not move them via
      // effectTarget/effectTargetsWeighted decay either.
      if (MIRROR_CONTROLLED_METRIC_IDS.has(metricId)) continue;
      const metricData = (categoryData as Record<string, StateMetricValue>)[metricId];

      if (!metricData || typeof metricData.value !== "number") continue;

      const currentValue = metricData.value;

      // Calculate target for this metric (now synchronous)
      const target = calculateMetricTarget(
        baselineDoc,
        categoryId,
        metricId,
        policies,
        legTypeMap,
        currentTurn,
        currentValue
      );

      // Apply exponential decay toward target
      const newValue = applyPolicyDecay(currentValue, target);

      // Clamp to metric-specific bounds (default 0-100)
      const metricDef = getMetricDefinition(categoryId, metricId);
      const minVal = metricDef?.minValue ?? 0;
      const maxVal = metricDef?.maxValue ?? 100;
      const clampedValue = Math.max(minVal, Math.min(maxVal, newValue));

      // Only update if change is significant
      if (Math.abs(clampedValue - currentValue) > MIN_CHANGE_THRESHOLD) {
        updates[`${categoryId}.${metricId}.value`] = clampedValue;
      }
    }
  }

  // Apply direct per-turn metric effects from policy options' metricEffects (additive)
  const tickRates = computeTickRates(policies, legTypeMap);
  for (const [category, metricRates] of Object.entries(tickRates)) {
    const categoryData = currentMetrics[category as MetricCategoryId];
    if (!categoryData || typeof categoryData !== "object") continue;

    for (const [metricId, rate] of Object.entries(metricRates)) {
      if (rate === 0) continue;
      const metricData = (categoryData as Record<string, StateMetricValue>)[metricId];
      if (!metricData || typeof metricData.value !== "number") continue;

      const metricDef = getMetricDefinition(category as MetricCategoryId, metricId);
      const minVal = metricDef?.minValue ?? 0;
      const maxVal = metricDef?.maxValue ?? 100;
      const key = `${category}.${metricId}.value`;
      // Base is either the already-decayed value or the current value
      const base = updates[key] ?? metricData.value;
      const newVal = Math.max(minVal, Math.min(maxVal, base + rate));
      if (Math.abs(newVal - metricData.value) > MIN_CHANGE_THRESHOLD) {
        updates[key] = newVal;
      }
    }
  }

  // Apply updates if any — SP5: route economic./population. paths to
  // macroMetrics, everything else to stateMetrics.
  if (Object.keys(updates).length > 0) {
    const now = new Date();
    const politicalSet: Record<string, unknown> = {};
    const macroSet: Record<string, unknown> = {};
    for (const [path, value] of Object.entries(updates)) {
      if (isMacroMetricPath(path)) macroSet[path] = value;
      else politicalSet[path] = value;
    }
    // Political paths are classified but not written: this loop only runs for a
    // country with no political board, and there is none. Kept as a classifier
    // so the macro/political boundary stays explicit here.
    const writes: Promise<unknown>[] = [];
    if (Object.keys(macroSet).length > 0) {
      writes.push(
        db
          .collection<StateMetrics>("macroMetrics")
          .updateOne({ _id: stateId }, { $set: { ...macroSet, lastUpdated: now } })
      );
    }
    await Promise.all(writes);
  }
}

/**
 * Process policy effects for all states
 * @param db - MongoDB database instance
 */
export async function processStatePolicyEffects(db: Db): Promise<void> {
  const gameStateCollection = db.collection<GameState>("gameState");

  // Get game state for current turn (needed for time-based effect decay)
  const gameState =
    (await gameStateCollection.findOne({ _id: "current" })) ??
    (await gameStateCollection.findOne({ _id: "main" }));
  const currentTurn = gameState?.currentTurn ?? 0;
  // Era gate year (reuses the already-fetched gameState — no extra read). Null
  // when the flag is off, so every isMetricActive check below returns true.
  const eraYear = gameState?.eraSystemEnabled ? resolveGameYear(gameState) : null;

  // Bulk-fetch ALL data upfront in parallel (eliminates per-state queries)
  const [states, allStatePolicies, allLegTypes, allStateMetrics, allStateBaselines] =
    await Promise.all([
      db.collection<State>("states").find({}).toArray(),
      db.collection<StatePolicy>("statePolicies").find({}).toArray(),
      db.collection<LegislationType>("legislationTypes").find({}).toArray(),
      // SP5: merged two-store view — economic/population inputs live on macroMetrics.
      findMergedRegionMetricsMany(db, {}),
      db.collection<StateMetricBaseline>("stateBaselines").find({}).toArray(),
    ]);

  // Build legislation type map for O(1) lookups
  const legTypeMap: LegislationTypeMap = new Map();
  for (const legType of allLegTypes) {
    legTypeMap.set(legType._id, legType);
  }

  // Group policies by stateId
  const policiesByState = new Map<string, StatePolicy[]>();
  for (const policy of allStatePolicies) {
    const list = policiesByState.get(policy.stateId) ?? [];
    list.push(policy);
    policiesByState.set(policy.stateId, list);
  }

  // Build federal/UK national policies with country-aware scope multipliers.
  // US uses 1/50 and UK uses 1/12 so that the sum of per-region effects equals
  // the intended national total regardless of region count.
  const federalPolicies: ActivePolicy[] = (policiesByState.get("federal") ?? []).map((p) => ({
    ...p,
    scopeMultiplier: getFederalMultiplier("US"),
  }));
  const ukNationalPolicies: ActivePolicy[] = (policiesByState.get("uk_national") ?? []).map(
    (p) => ({ ...p, scopeMultiplier: getFederalMultiplier("UK") })
  );
  const jpNationalPolicies: ActivePolicy[] = (policiesByState.get("jp_national") ?? []).map(
    (p) => ({ ...p, scopeMultiplier: getFederalMultiplier("JP") })
  );
  const deNationalPolicies: ActivePolicy[] = (policiesByState.get("de_national") ?? []).map(
    (p) => ({ ...p, scopeMultiplier: getFederalMultiplier("DE") })
  );

  // Build lookup maps for metrics and baselines
  const metricsMap = new Map(allStateMetrics.map((m) => [String(m._id), m]));
  const baselinesMap = new Map(allStateBaselines.map((b) => [String(b._id), b]));

  // Process all states in-memory, collect DB updates.
  const macroBulkOps: {
    updateOne: { filter: { _id: string }; update: { $set: Record<string, unknown> } };
  }[] = [];
  const MIN_CHANGE_THRESHOLD = 0.001;

  for (const state of states) {
    // Country gate. Every board country skips this loop: its political metrics
    // live on the board, whose sole animator is the dynamics phase, and its
    // economic survivors are animated by the metric engine (spec §4). Running
    // the legacy decay/policy loop for them would fight both over the same
    // numbers. Only a country with no board (SCO/WAL) still runs here.
    if (isPoliticalApprovalCountry(state.countryId)) continue;
    const nationalPoliciesByScope: Record<string, ActivePolicy[]> = {
      federal: federalPolicies,
      uk_national: ukNationalPolicies,
      jp_national: jpNationalPolicies,
      de_national: deNationalPolicies,
    };
    const nationalScopeId = getNationalDocId(state.countryId);
    const nationalPolicies =
      (nationalScopeId ? nationalPoliciesByScope[nationalScopeId] : undefined) ?? federalPolicies;
    const statePoliciesArray = policiesByState.get(state._id) ?? [];
    const stateWithMultiplier: ActivePolicy[] = statePoliciesArray.map((p) => ({
      ...p,
      scopeMultiplier: 1.0,
    }));
    const policies = [...stateWithMultiplier, ...nationalPolicies];

    const currentMetrics = metricsMap.get(state._id);
    if (!currentMetrics) continue;

    const baselineDoc = baselinesMap.get(state._id) ?? null;
    const updates: Record<string, number> = {};

    // Process each category and metric
    for (const category of metricCategories) {
      const categoryId = category.id as MetricCategoryId;
      const categoryData = currentMetrics[categoryId];
      if (!categoryData || typeof categoryData !== "object") continue;

      for (const metric of category.metrics) {
        const metricId = metric.id;
        // Ownership chokepoint: metrics owned by a dedicated drift engine are
        // not decayed here — the policy layer co-writing them would fight the
        // drift engine to a standstill (the SCO/WAL independence-desire freeze).
        if (DRIFT_OWNED_METRICS.has(`${categoryId}.${metricId}`)) continue;
        const metricData = (categoryData as Record<string, StateMetricValue>)[metricId];
        if (!metricData || typeof metricData.value !== "number") continue;

        const currentValue = metricData.value;
        const target = calculateMetricTarget(
          baselineDoc,
          categoryId,
          metricId,
          policies,
          legTypeMap,
          currentTurn,
          currentValue,
          state.countryId,
          eraYear
        );
        const newValue = applyPolicyDecay(currentValue, target);
        const metricDef = getMetricDefinition(categoryId, metricId);
        const minVal = metricDef?.minValue ?? 0;
        const maxVal = metricDef?.maxValue ?? 100;
        const clampedValue = Math.max(minVal, Math.min(maxVal, newValue));

        if (Math.abs(clampedValue - currentValue) > MIN_CHANGE_THRESHOLD) {
          updates[`${categoryId}.${metricId}.value`] = clampedValue;
        }
      }
    }

    // Apply direct per-turn metric effects. Era-gated by (country, year) so a law
    // cannot tick a metric that does not exist yet; natural baseline decay above
    // is deliberately left intact (matches the metric catalog's "keep writing,
    // just hide" model). Null eraYear (flag off) ⇒ every metric active.
    const tickRates = computeTickRates(policies, legTypeMap, state.countryId, eraYear);
    for (const [category, metricRates] of Object.entries(tickRates)) {
      const categoryData = currentMetrics[category as MetricCategoryId];
      if (!categoryData || typeof categoryData !== "object") continue;

      for (const [metricId, rate] of Object.entries(metricRates)) {
        if (rate === 0) continue;
        // Ownership chokepoint (see decay loop above): never apply per-turn
        // policy tick rates to a drift-engine-owned metric.
        if (DRIFT_OWNED_METRICS.has(`${category}.${metricId}`)) continue;
        const metricData = (categoryData as Record<string, StateMetricValue>)[metricId];
        if (!metricData || typeof metricData.value !== "number") continue;

        const metricDef = getMetricDefinition(category as MetricCategoryId, metricId);
        const minVal = metricDef?.minValue ?? 0;
        const maxVal = metricDef?.maxValue ?? 100;
        const key = `${category}.${metricId}.value`;
        const base = updates[key] ?? metricData.value;
        const newVal = Math.max(minVal, Math.min(maxVal, base + rate));
        if (Math.abs(newVal - metricData.value) > MIN_CHANGE_THRESHOLD) {
          updates[key] = newVal;
        }
      }
    }

    if (Object.keys(updates).length > 0) {
      // Every update here is a MACRO path, structurally: both loops above skip
      // any metric absent from `currentMetrics`, and `currentMetrics` is the
      // merged region doc, which carries no political categories. The filter
      // stays as the guard rather than an assumption — a political path
      // reaching this point would mean the policy layer is trying to co-write
      // the board, which `processPoliticalMetricsDynamics` owns, and writing it
      // into the macro doc would corrupt that doc's shape rather than fail.
      const macroSet: Record<string, unknown> = {};
      for (const [path, value] of Object.entries(updates)) {
        if (isMacroMetricPath(path)) macroSet[path] = value;
      }
      if (Object.keys(macroSet).length > 0) {
        macroBulkOps.push({
          updateOne: {
            filter: { _id: state._id },
            update: { $set: { ...macroSet, lastUpdated: new Date() } },
          },
        });
      }
    }
  }

  // One bulkWrite instead of N individual updateOne calls
  if (macroBulkOps.length > 0) {
    await db.collection<StateMetrics>("macroMetrics").bulkWrite(macroBulkOps);
  }
}
