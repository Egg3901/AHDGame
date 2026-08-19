/**
 * Resolved turnout calculator for elections and polls.
 *
 * Bridges the gap between static StateDemographics.turnout and dynamic
 * StateDemographicTurnout.modifiers applied via GOTV, canvassing, and suppression.
 *
 * Why this matters:
 * - StateDemographics stores baseline turnout rates per group
 * - StateDemographicTurnout stores runtime modifiers (-20 to +20 percentage points)
 * - Elections and polls use the combined (baseline + modifier) rate
 */

import type { DemographicCategory, StateDemographics } from "@/lib/db/types";
import type { StateDemographicTurnout } from "@/lib/db/types/stateDemographicTurnout";
import { stateCensusData, deriveGroupTurnout } from "@/lib/seeds/stateDemographics";
import { DEMOGRAPHIC_TURNOUT_RATES } from "@/lib/seeds/demographicCategories";
import { getRegionCensusData } from "@/lib/seeds/regionCensusData";
import { eraForPreset } from "@/lib/seeds/presetSelector";
import { getUsSubstrateForYear, getUsTurnoutRatesForYear } from "@/lib/seeds/eraSubstrateForYear";
import { eraIdForYear } from "@/lib/seeds/eraInterpolation";
import type { Layer1Config } from "@/lib/seeds/stateDemographicsPure";
import { DEFAULT_SEED_PRESET } from "@/lib/constants/seedPreset";

const LAYER1_DIMS = ["race", "age", "education", "wealth", "ideology"] as const;
type Layer1Dim = (typeof LAYER1_DIMS)[number];

/**
 * For US-style states (those with a Layer-1 census config registered in
 * stateCensusData), recompute each archetype's effective turnout from the
 * Layer-1 baselines + any per-dimension modifiers stored on turnoutDoc.
 *
 * US canvassing and GOTV write modifiers like `modifiers.race.white = -9.6`
 * (keys are demographic groups, not archetype IDs). The archetype-keyed
 * lookup below never matches these, so without this step those modifiers
 * would silently have zero effect on elections. Pulling them through
 * deriveGroupTurnout reuses the same composition logic that built the
 * stored archetype turnouts in the first place.
 *
 * Returns null for non-US states (UK/JP/etc) so callers fall back to the
 * stored archetype turnout + archetype-keyed modifier path.
 */
function computeLayer1DerivedArchetypeTurnouts(
  stateId: string,
  categories: DemographicCategory[],
  turnoutDoc: StateDemographicTurnout | null | undefined,
  preset?: string,
  year?: number | null,
  startingYear?: number | null
): Record<string, number> | null {
  // Membership in the 2019 US bundle is the "is this a Layer-1 US state"
  // discriminator; the actual census shares come from the era bundle matching
  // the world's reset preset (falls back to 2019 for unregistered presets).
  if (!stateCensusData[stateId]) return null;
  // Year-driven when the era clock is live, so the LEGACY archetype path sees
  // the same electorate the granular path does. Two engines disagreeing about
  // what year it is would be worse than either being wrong consistently.
  const yearSubstrate =
    year != null
      ? getUsSubstrateForYear(stateId, year, { startingYear: startingYear ?? null })
      : null;
  const config =
    (yearSubstrate?.config as Layer1Config | null) ??
    (getRegionCensusData("US", stateId, preset) as Layer1Config | null) ??
    stateCensusData[stateId];
  const era = year != null ? eraIdForYear(year) : eraForPreset(preset ?? DEFAULT_SEED_PRESET);
  const eraRates =
    year != null
      ? (getUsTurnoutRatesForYear(stateId, year, {
          startingYear: startingYear ?? null,
        }) as unknown as Record<string, Record<string, number>>)
      : null;

  const stateSpecificTurnout: Record<Layer1Dim, Record<string, number>> = {
    race: {},
    age: {},
    education: {},
    wealth: {},
    ideology: {},
  };
  for (const dim of LAYER1_DIMS) {
    const baselines = (eraRates?.[dim] ??
      (DEMOGRAPHIC_TURNOUT_RATES[dim] as Record<string, number>)) as Record<string, number>;
    const dimModifiers = turnoutDoc?.modifiers?.[dim] ?? {};
    for (const [key, baseline] of Object.entries(baselines)) {
      stateSpecificTurnout[dim][key] = baseline + (dimModifiers[key] ?? 0);
    }
  }

  const result: Record<string, number> = {};
  for (const category of categories) {
    for (const group of category.groups) {
      const baseTurnout = group.defaultTurnout ?? 55;
      result[group.id] = deriveGroupTurnout(
        group.id,
        config,
        baseTurnout,
        era,
        stateSpecificTurnout
      );
    }
  }
  return result;
}

export interface ResolvedTurnout {
  /** Effective turnout percentage (0-100) for each group ID */
  byGroup: Record<string, number>;
  /** Total weighted turnout pool for the state */
  totalPool: number;
}

export interface ResolvedTurnoutOptions {
  /** Optional explicit turnout modifiers to apply (groupId -> modifier in percentage points) */
  modifierOverrides?: Record<string, number>;
  /** Clamp minimum turnout to this value (default: 0) */
  minTurnout?: number;
  /** Clamp maximum turnout to this value (default: 100) */
  maxTurnout?: number;
  /**
   * Reset-preset id of the current world (e.g. "1991-default"). Selects the
   * era-correct US census bundle + turnout-rate table for Layer-1 derivation.
   * Defaults to the 2019 era when omitted.
   */
  preset?: string;
  /**
   * Live in-game year (`gameState.currentYear`). When set, the Layer-1 census
   * bundle AND the turnout-rate baselines resolve from the year rather than
   * the seed preset, matching the granular substrate. Null keeps legacy
   * preset-driven behavior exactly.
   */
  year?: number | null;
  /** World `gameState.startingYear` — gates era-checkpoint de-duplication. */
  startingYear?: number | null;
}

/**
 * Resolve effective turnout rates for all demographic groups in a state.
 *
 * Combines baseline turnout from StateDemographics with runtime modifiers
 * from StateDemographicTurnout. Modifiers are clamped to valid ranges
 * and applied as percentage point adjustments.
 *
 * @param statePopulation - Total population of the state/region
 * @param demographics - Static demographic data with baseline turnout rates
 * @param categories - Active demographic categories for this country/state
 * @param turnoutDoc - Optional dynamic turnout modifiers from GOTV/canvassing/suppression
 * @param options - Optional overrides and clamping settings
 * @returns Resolved turnout rates by group and total weighted pool
 *
 * @example
 * ```typescript
 * const resolved = resolveTurnout(
 *   state.population,
 *   stateDemographics,
 *   demographicCategories,
 *   turnoutDoc, // from stateDemographicTurnout collection
 * );
 *
 * // Use in election calculation
 * const turnoutPct = resolved.byGroup[group.id];
 * ```
 */
export function resolveTurnout(
  statePopulation: number,
  demographics: StateDemographics,
  categories: DemographicCategory[],
  turnoutDoc: StateDemographicTurnout | null | undefined,
  options: ResolvedTurnoutOptions = {}
): ResolvedTurnout {
  const { modifierOverrides, minTurnout = 0, maxTurnout = 100 } = options;

  const byGroup: Record<string, number> = {};
  let totalPool = 0;

  // Category weights partition the SAME electorate into different slices
  // (voterGroups vs age vs education …), so they must be treated as relative
  // weights that sum to 1 — otherwise a world whose categoryWeights sum to >100
  // inflates the pool above the state population (the "election has more votes
  // than people" bug). Normalize by their actual sum instead of a hard-coded
  // 100; falls back to 100 when no positive weights exist.
  const totalCategoryWeight =
    categories.reduce((sum, c) => {
      const w = demographics.categoryWeights[c._id] ?? 0;
      return w > 0 ? sum + w : sum;
    }, 0) || 100;

  // For US-style states this recomputes archetype turnouts with Layer-1
  // modifiers folded in (race/age/edu/wealth/ideology); null for UK/JP, where
  // we keep using the stored archetype turnout and apply archetype-keyed
  // modifiers below.
  const layer1Derived = computeLayer1DerivedArchetypeTurnouts(
    demographics._id,
    categories,
    turnoutDoc,
    options.preset,
    options.year ?? null,
    options.startingYear ?? null
  );

  for (const category of categories) {
    const categoryWeight = demographics.categoryWeights[category._id] ?? 0;
    if (categoryWeight <= 0) continue;

    for (const group of category.groups) {
      const stateGroup = demographics.groups[group.id];

      // Baseline turnout: Layer-1-derived (US, modifiers already folded in)
      // > stored archetype turnout > default.
      const baselineTurnout =
        layer1Derived?.[group.id] ??
        (typeof stateGroup?.turnout === "number"
          ? stateGroup.turnout
          : (group.defaultTurnout ?? 55));

      // Apply archetype-keyed modifiers from turnoutDoc (UK/JP voterGroups,
      // or any new-format US modifier). For US Layer-1 modifiers the inner
      // keys are demographic groups, not archetype IDs, so this loop is a
      // no-op for them — their effect is already in baselineTurnout.
      let modifier = 0;
      if (turnoutDoc?.modifiers) {
        for (const [_categoryId, groupModifiers] of Object.entries(turnoutDoc.modifiers)) {
          if (groupModifiers && typeof groupModifiers === "object") {
            const groupModifier = groupModifiers[group.id];
            if (typeof groupModifier === "number") {
              modifier += groupModifier;
            }
          }
        }
      }

      if (modifierOverrides?.[group.id] != null) {
        modifier = modifierOverrides[group.id];
      }

      const effectiveTurnout = Math.max(
        minTurnout,
        Math.min(maxTurnout, baselineTurnout + modifier)
      );

      byGroup[group.id] = effectiveTurnout;

      const populationPct = stateGroup?.population ?? 0;
      const groupContribution = statePopulation * (populationPct / 100) * (effectiveTurnout / 100);
      totalPool += groupContribution * (categoryWeight / totalCategoryWeight);
    }
  }

  // Hard guarantee: the vote pool can never exceed the eligible electorate,
  // whatever the category/group data looks like. Turnout ≤ 100% already keeps
  // it under normally; this is the backstop against malformed demographics.
  return { byGroup, totalPool: Math.round(Math.min(totalPool, statePopulation)) };
}

/**
 * Calculate effective turnout for a single demographic group.
 *
 * Use this when you only need one group's turnout without computing the full state.
 *
 * @param groupId - The demographic group ID (e.g., "college_liberals")
 * @param baselineTurnout - Baseline turnout percentage for the group
 * @param turnoutDoc - Optional turnout modifiers document
 * @param options - Optional overrides and clamping
 * @returns Effective turnout percentage (0-100)
 */
export function resolveSingleGroupTurnout(
  groupId: string,
  baselineTurnout: number,
  turnoutDoc: StateDemographicTurnout | null | undefined,
  options: ResolvedTurnoutOptions = {}
): number {
  const { modifierOverrides, minTurnout = 0, maxTurnout = 100 } = options;

  let modifier = 0;
  if (turnoutDoc?.modifiers) {
    for (const groupModifiers of Object.values(turnoutDoc.modifiers)) {
      if (groupModifiers && typeof groupModifiers === "object") {
        const groupModifier = groupModifiers[groupId];
        if (typeof groupModifier === "number") {
          modifier += groupModifier;
        }
      }
    }
  }

  if (modifierOverrides?.[groupId] != null) {
    modifier = modifierOverrides[groupId];
  }

  return Math.max(minTurnout, Math.min(maxTurnout, baselineTurnout + modifier));
}

/**
 * Build a liveTurnouts lookup compatible with pollCalculations.computePollData.
 *
 * This produces a Record<groupId, turnoutPct> that can be passed as the
 * liveTurnouts parameter to computePollData for unified poll/election behavior.
 *
 * @param demographics - Static demographic data
 * @param categories - Active demographic categories
 * @param turnoutDoc - Optional turnout modifiers
 * @param options - Optional overrides
 * @returns Record mapping group IDs to effective turnout percentages
 */
export function buildLiveTurnouts(
  demographics: StateDemographics,
  categories: DemographicCategory[],
  turnoutDoc: StateDemographicTurnout | null | undefined,
  options: ResolvedTurnoutOptions = {}
): Record<string, number> {
  const liveTurnouts: Record<string, number> = {};

  const layer1Derived = computeLayer1DerivedArchetypeTurnouts(
    demographics._id,
    categories,
    turnoutDoc,
    options.preset,
    options.year ?? null,
    options.startingYear ?? null
  );

  for (const category of categories) {
    for (const group of category.groups) {
      const stateGroup = demographics.groups[group.id];
      const baselineTurnout =
        layer1Derived?.[group.id] ??
        (typeof stateGroup?.turnout === "number"
          ? stateGroup.turnout
          : (group.defaultTurnout ?? 55));

      const effectiveTurnout = resolveSingleGroupTurnout(
        group.id,
        baselineTurnout,
        turnoutDoc,
        options
      );

      liveTurnouts[group.id] = effectiveTurnout;
    }
  }

  return liveTurnouts;
}
