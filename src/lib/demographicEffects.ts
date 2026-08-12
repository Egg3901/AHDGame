/**
 * Demographic Effects Processing Module
 *
 * Processes how policies shift demographics over time. Two generations of
 * effect channels exist on `LegislationType.demographicEffects[]`:
 *
 *  - population (legacy, always active): policies shift a voter group's
 *    population share. E.g. education funding gradually grows the
 *    college-educated share of a state.
 *  - economicLean / socialLean / turnout (v2, gated on the
 *    `legislationDemographicEffectsV2Enabled` game-state flag): policies shift
 *    a voter group's political lean and turnout — the "legislation →
 *    demographics → elections" link. E.g. pro-labour laws pull union workers'
 *    economic lean toward the law's direction and nudge their turnout up.
 *
 * KEY DESIGN DECISIONS:
 *
 * 1. Cumulative shifts: Each policy contributes additive shifts to specific
 *    demographic groups. Multiple policies affecting the same group stack.
 *
 * 2. Federal effect division: Federal policies apply at 1/50 strength per US state
 *    and 1/12 strength per UK region. This prevents a single national bill from
 *    dominating region-level demographics and ensures the sum of per-region
 *    effects roughly equals the intended national total. Lean/turnout targets
 *    reuse the exact same scope multiplier as the population channel.
 *
 * 3. Policy strength normalization: Policy economic/social scores (-3 to +3)
 *    are normalized to -1 to +1 range before applying shifts. This creates
 *    a consistent scale across all legislation types. (Some seed options score
 *    up to ±5, i.e. strength up to ±1.67 — pre-existing behavior, shared by
 *    all channels.)
 *
 * 4. Shift rate: SHIFT_RATE_PER_TURN = 0.1% maximum population shift per turn
 *    when policy is at full strength (+3 or -3). Lean/turnout rates are
 *    documented on their constants below.
 *
 * 5. Natural decay: population-analog metrics decay naturally toward baseline
 *    at 0.25%/turn when no active policy is pushing them (see
 *    src/lib/turn/metricDecay.ts DECAY_RATE). Lean/turnout use the same
 *    proportional 0.25%/turn decay toward the state's SEEDED per-group
 *    baseline (`demographicDefaults` collection, falling back to the
 *    DemographicCategory template defaults) whenever no active law targets
 *    that group+axis, so lean drift reverts after legislation is repealed
 *    without eroding intentional per-state seed variation.
 */

import { loadDemographicCategories } from "@/lib/demographics/categoryCatalog";
import type { Db } from "mongodb";
import type { DemographicCategory, StateDemographics } from "@/lib/db/types/demographics";
import type {
  DemographicEffect,
  DemographicEffectTarget,
  LegislationType,
} from "@/lib/db/types/legislation";
import type { GameState } from "@/lib/db/types/gameState";
import type { State } from "@/lib/db/types/state";
import { getFederalMultiplier } from "@shared/constants/formulas";
import { calculateStateLeanForCache } from "@/lib/demographics/cachedStateLean";
import {
  applyDurableGroupShift,
  applyDurableGroupTurnoutShift,
  readLayer1Overlay,
  readLayer1TurnoutOverlay,
  type DurableShiftAccumulators,
} from "@/lib/demographics/durableRealignment";
import {
  getActivePoliciesForState,
  type ActivePolicy,
  type LegislationTypeMap,
} from "./policyEffects";

/**
 * Population shift rate per turn at maximum policy strength.
 * 0.1 = 0.1% population shift per turn when policy is at full strength (+3 or -3)
 */
export const SHIFT_RATE_PER_TURN = 0.1;

/**
 * Lean shift per turn at maximum policy strength (magnitude 1, state scope).
 * Group leans live on the shared −5..+5 axis (see DemographicCategory group
 * defaults and calculateStateLean's ±5 clamp), so the axis range is 10 units
 * and 10% of the range is 1.0 lean. At 0.035/turn a max-strength (±3 ⇒
 * strength 1.0) state law moves a group's lean by 1.0 in ~29 turns (~0.6 game
 * years) — inside the intended 20-40 turn window; the strongest ±5 seed
 * options (strength 1.67) reach it in ~17 turns.
 */
export const LEAN_SHIFT_RATE_PER_TURN = 0.035;

/**
 * Maximum cumulative lean deviation legislation may build up from a group's
 * seeded baseline: 1.5 lean = 15% of the 10-unit axis. Values already outside
 * the band (seed variation, admin edits) are never snapped inward — the band
 * only stops legislation from pushing further out.
 */
export const LEAN_MAX_DEVIATION_FROM_BASELINE = 1.5;

/**
 * Turnout shift per turn at maximum policy strength (magnitude 1, state
 * scope), in percentage points on the 0-100 turnout scale
 * (StateDemographicGroup.turnout). 0.25/turn ⇒ a max-strength law needs 40
 * turns to move a group's turnout by 10 points. Deliberately reaches its own
 * (tighter) deviation cap at the slow end of the 20-40-turn lean window:
 * real-world mobilization laws move turnout by a few points, not tens.
 */
export const TURNOUT_SHIFT_RATE_PER_TURN = 0.25;

/**
 * Maximum cumulative turnout deviation legislation may build up from a
 * group's seeded baseline: 10 percentage points (10% of the 0-100 range —
 * tighter than the lean band; see TURNOUT_SHIFT_RATE_PER_TURN rationale).
 */
export const TURNOUT_MAX_DEVIATION_FROM_BASELINE = 10;

/**
 * Proportional decay per turn of a group's lean/turnout back toward its seeded
 * baseline when NO active law targets that group+axis. Matches the 0.25%/turn
 * natural metric decay (src/lib/turn/metricDecay.ts DECAY_RATE) so legislative
 * lean drift reverts on the same timescale metrics do (~19 game years for 90%
 * reversion).
 */
export const LEAN_TURNOUT_DECAY_RATE_PER_TURN = 0.0025;

/** Bounds for DemographicEffect.magnitude — seed typos cannot create runaway shifts. */
export const DEMOGRAPHIC_EFFECT_MAGNITUDE_MIN = 0.25;
export const DEMOGRAPHIC_EFFECT_MAGNITUDE_MAX = 3;

/** Absolute bounds of the lean axis (shared −5..+5 ruler). */
const LEAN_ABS_MIN = -5;
const LEAN_ABS_MAX = 5;
/** Absolute bounds of the turnout scale (percentage). */
const TURNOUT_ABS_MIN = 0;
const TURNOUT_ABS_MAX = 100;

/** Skip very small changes (floating point churn guard, shared by all channels). */
const MIN_CHANGE_THRESHOLD = 0.0001;

/**
 * Runtime gate for the v2 lean/turnout channels. Fail-closed: an absent flag
 * reads as false, so pre-existing worlds keep population-only behavior until
 * an admin enables the gate (fresh worlds seed it true via
 * DEFAULT_GAME_STATE_FLAGS).
 */
export function isLegislationDemographicEffectsV2Enabled(
  gameState: Pick<GameState, "legislationDemographicEffectsV2Enabled"> | null | undefined
): boolean {
  return gameState?.legislationDemographicEffectsV2Enabled === true;
}

/** Clamp an effect's magnitude to [0.25, 3]; absent = 1. */
export function clampDemographicEffectMagnitude(magnitude: number | undefined): number {
  if (typeof magnitude !== "number" || !Number.isFinite(magnitude)) return 1;
  return Math.max(
    DEMOGRAPHIC_EFFECT_MAGNITUDE_MIN,
    Math.min(DEMOGRAPHIC_EFFECT_MAGNITUDE_MAX, magnitude)
  );
}

/** Per-target accumulated shifts: groupId → per-turn delta. */
export interface DemographicShiftSet {
  population: Record<string, number>;
  /** Note: `calculateDemographicShiftsByTarget` includes EVERY effect (permanent or not) — see that function's doc comment for why. `subtractDurableShifts` is what narrows this down to the temporary-only rate `buildDemographicUpdates` consumes. */
  economicLean: Record<string, number>;
  socialLean: Record<string, number>;
  turnout: Record<string, number>;
}

const SHIFT_RATE_BY_TARGET: Record<DemographicEffectTarget, number> = {
  population: SHIFT_RATE_PER_TURN,
  economicLean: LEAN_SHIFT_RATE_PER_TURN,
  socialLean: LEAN_SHIFT_RATE_PER_TURN,
  turnout: TURNOUT_SHIFT_RATE_PER_TURN,
};

/**
 * Shared per-turn shift-rate computation, filtered by an effect predicate.
 * `calculateDemographicShiftsByTarget` (all effects) and
 * `calculateDurableDemographicShiftsByTarget` (`permanent: true` effects
 * only) are both thin wrappers over this — same formula, different subset.
 */
function computeShiftsByTarget(
  policies: ActivePolicy[],
  legTypeMap: LegislationTypeMap,
  include: (effect: DemographicEffect) => boolean
): DemographicShiftSet {
  const shifts: DemographicShiftSet = {
    population: {},
    economicLean: {},
    socialLean: {},
    turnout: {},
  };

  for (const policy of policies) {
    const legType = legTypeMap.get(policy.legislationTypeId);

    if (!legType?.demographicEffects || legType.demographicEffects.length === 0) {
      continue;
    }

    // Normalize policy strength to -1 to +1 range
    // policy.economic ranges from -3 to +3
    const strength = policy.economic / 3;

    for (const effect of legType.demographicEffects) {
      if (!include(effect)) continue;
      const target: DemographicEffectTarget = effect.target ?? "population";
      // Calculate shift amount:
      // - effect.direction: base rate of change (-1 to +1)
      // - strength: normalized policy strength (same scaling for every target)
      // - scopeMultiplier: 1.0 for state, 1/N for federal/national
      // - rate: per-target maximum shift per turn
      // - magnitude: optional per-effect multiplier, clamped to [0.25, 3].
      //   Population ignores it: that channel is the ungated legacy path, and
      //   a magnitude there would change flag-off behavior the moment a seed
      //   entry set one.
      const magnitude =
        target === "population" ? 1 : clampDemographicEffectMagnitude(effect.magnitude);
      const shiftAmount =
        effect.direction *
        strength *
        policy.scopeMultiplier *
        SHIFT_RATE_BY_TARGET[target] *
        magnitude;

      const channel = shifts[target];
      channel[effect.groupId] = (channel[effect.groupId] ?? 0) + shiftAmount;
    }
  }

  return shifts;
}

/**
 * Calculate cumulative demographic shifts from all active policies, routed by
 * effect target. Effects without a `target` are population effects (legacy).
 * Includes EVERY effect regardless of `permanent` — this is also what
 * `eraCheckpointTurn.ts`'s counter-pressure netting reads, and a durable
 * ("permanent") law's ongoing per-turn pull should count as counter-pressure
 * against an era checkpoint (or vice versa) exactly like an ordinary one
 * does; `calculateDurableDemographicShiftsByTarget` below is the narrower
 * view used to route the durable subset to the non-decaying channel.
 * @param policies - Array of active policies with scope multipliers
 * @param legTypeMap - Pre-fetched map of legislation type IDs to documents
 */
export function calculateDemographicShiftsByTarget(
  policies: ActivePolicy[],
  legTypeMap: LegislationTypeMap
): DemographicShiftSet {
  return computeShiftsByTarget(policies, legTypeMap, () => true);
}

/**
 * Same computation, restricted to `permanent: true` lean/turnout effects —
 * the per-turn rate that durably relocates a group's base value (see
 * `DemographicEffect.permanent`'s doc comment and
 * `src/lib/demographics/durableRealignment.ts`) rather than applying a
 * capped, decaying overlay. `population` is excluded: it is the always-on
 * legacy channel and has no durable/temporary distinction to make (there is
 * no "seeded baseline" it decays toward in the first place). `turnout` IS
 * included — the Voting Rights Act's enfranchisement effect (see
 * `DemographicEffect.permanent`'s doc comment) is a durable TURNOUT shift,
 * not a lean one, and routes through `applyDurableGroupTurnoutShift`'s
 * dedicated turnout-rate overlay (`layer1TurnoutOverrides`), not the lean
 * channel's `layer1PositionOverrides`.
 */
export function calculateDurableDemographicShiftsByTarget(
  policies: ActivePolicy[],
  legTypeMap: LegislationTypeMap
): DemographicShiftSet {
  return computeShiftsByTarget(
    policies,
    legTypeMap,
    (effect) =>
      effect.permanent === true &&
      (effect.target === "economicLean" ||
        effect.target === "socialLean" ||
        effect.target === "turnout")
  );
}

/**
 * Subtract a durable shift set (already counted once in `total`) out of the
 * total, per group+axis, leaving the TEMPORARY-only rate that should still
 * go through the capped/decaying channel (`buildDemographicUpdates`).
 * `population` is never non-empty in `durable` (see
 * `calculateDurableDemographicShiftsByTarget`'s doc comment) and passes
 * through untouched.
 */
export function subtractDurableShifts(
  total: DemographicShiftSet,
  durable: DemographicShiftSet
): DemographicShiftSet {
  const subtractChannel = (
    t: Record<string, number>,
    d: Record<string, number>
  ): Record<string, number> => {
    if (Object.keys(d).length === 0) return t;
    const out: Record<string, number> = { ...t };
    for (const [groupId, value] of Object.entries(d)) {
      out[groupId] = (out[groupId] ?? 0) - value;
    }
    return out;
  };
  return {
    population: total.population,
    economicLean: subtractChannel(total.economicLean, durable.economicLean),
    socialLean: subtractChannel(total.socialLean, durable.socialLean),
    turnout: subtractChannel(total.turnout, durable.turnout),
  };
}

/**
 * Legacy population-only view of calculateDemographicShiftsByTarget.
 * Kept for backward compatibility: for seed data without `target` fields the
 * result is identical to the pre-v2 implementation.
 * @returns Record of groupId to population shift amount
 */
export function calculateDemographicShifts(
  policies: ActivePolicy[],
  legTypeMap: LegislationTypeMap
): Record<string, number> {
  return calculateDemographicShiftsByTarget(policies, legTypeMap).population;
}

/** Per-group baseline values that lean/turnout clamp to and decay toward. */
export interface DemographicGroupBaselines {
  economicLean?: number;
  socialLean?: number;
  turnout?: number;
}

/**
 * Build the per-group baseline map for one state.
 *
 * Preference order per group+field:
 *  1. The state's seeded defaults doc (`demographicDefaults` collection — the
 *     exact values the state was seeded with, preserving intentional per-state
 *     variation),
 *  2. the DemographicCategory template defaults.
 * Groups with neither source get no baseline and are left untouched by the v2
 * channels.
 */
export function buildGroupBaselineMap(
  categories: DemographicCategory[],
  stateDefaults: StateDemographics | null | undefined
): Map<string, DemographicGroupBaselines> {
  const map = new Map<string, DemographicGroupBaselines>();

  for (const category of categories) {
    for (const group of category.groups) {
      map.set(group.id, {
        economicLean: group.defaultEconomicLean,
        socialLean: group.defaultSocialLean,
        turnout: group.defaultTurnout,
      });
    }
  }

  if (stateDefaults?.groups) {
    for (const [groupId, group] of Object.entries(stateDefaults.groups)) {
      const existing = map.get(groupId) ?? {};
      map.set(groupId, {
        economicLean:
          typeof group.economicLean === "number" ? group.economicLean : existing.economicLean,
        socialLean: typeof group.socialLean === "number" ? group.socialLean : existing.socialLean,
        turnout: typeof group.turnout === "number" ? group.turnout : existing.turnout,
      });
    }
  }

  return map;
}

/**
 * Apply one turn of legislative shift to a lean/turnout value.
 *
 * The deviation band is one-directional: legislation can never push the value
 * further than ±maxDeviation from baseline, but a value already outside the
 * band (seed variation, admin edit) is not snapped inward — it simply cannot
 * move further out, and shifts back toward the band always apply.
 */
export function applyBandedShift(
  current: number,
  baseline: number,
  shift: number,
  maxDeviation: number,
  absMin: number,
  absMax: number
): number {
  let next = current + shift;
  if (shift > 0) {
    next = Math.min(next, Math.max(baseline + maxDeviation, current));
  } else if (shift < 0) {
    next = Math.max(next, Math.min(baseline - maxDeviation, current));
  }
  return Math.max(absMin, Math.min(absMax, next));
}

/**
 * One turn of proportional decay toward baseline (0.25% of remaining distance,
 * mirroring src/lib/turn/metricDecay.ts). Below the change threshold the value
 * is returned unchanged so no write is emitted.
 */
export function applyBaselineDecay(current: number, baseline: number): number {
  const distance = current - baseline;
  if (Math.abs(distance) < MIN_CHANGE_THRESHOLD) return current;
  return current - distance * LEAN_TURNOUT_DECAY_RATE_PER_TURN;
}

/**
 * Build the `$set` field updates for one state's demographics doc from a
 * shift set.
 *
 * - The population channel is always processed (legacy, ungated behavior).
 * - Lean/turnout channels run only when `v2Enabled`; each group+axis either
 *   receives its active legislative shift (band-clamped around its baseline)
 *   or decays toward its baseline.
 */
export function buildDemographicUpdates(
  demographics: StateDemographics,
  shifts: DemographicShiftSet,
  baselines: Map<string, DemographicGroupBaselines> | null,
  v2Enabled: boolean
): Record<string, number> {
  const updates: Record<string, number> = {};

  // ── Population channel (always on; byte-identical to legacy behavior) ──
  for (const [groupId, shift] of Object.entries(shifts.population)) {
    const currentPop = demographics.groups[groupId]?.population;
    if (currentPop === undefined) continue;
    const newPop = Math.max(0, currentPop + shift);
    if (Math.abs(newPop - currentPop) > MIN_CHANGE_THRESHOLD) {
      updates[`groups.${groupId}.population`] = newPop;
    }
  }

  if (!v2Enabled || !baselines) return updates;

  // ── Lean/turnout channels (v2, flag-gated) ──
  for (const [groupId, group] of Object.entries(demographics.groups)) {
    const baseline = baselines.get(groupId);
    if (!baseline) continue;

    const channels: Array<{
      field: "economicLean" | "socialLean" | "turnout";
      base: number | undefined;
      stored: number | undefined;
      shift: number | undefined;
      maxDeviation: number;
      absMin: number;
      absMax: number;
    }> = [
      {
        field: "economicLean",
        base: baseline.economicLean,
        stored: group.economicLean,
        shift: shifts.economicLean[groupId],
        maxDeviation: LEAN_MAX_DEVIATION_FROM_BASELINE,
        absMin: LEAN_ABS_MIN,
        absMax: LEAN_ABS_MAX,
      },
      {
        field: "socialLean",
        base: baseline.socialLean,
        stored: group.socialLean,
        shift: shifts.socialLean[groupId],
        maxDeviation: LEAN_MAX_DEVIATION_FROM_BASELINE,
        absMin: LEAN_ABS_MIN,
        absMax: LEAN_ABS_MAX,
      },
      {
        field: "turnout",
        base: baseline.turnout,
        stored: group.turnout,
        shift: shifts.turnout[groupId],
        maxDeviation: TURNOUT_MAX_DEVIATION_FROM_BASELINE,
        absMin: TURNOUT_ABS_MIN,
        absMax: TURNOUT_ABS_MAX,
      },
    ];

    for (const ch of channels) {
      if (typeof ch.base !== "number") continue;
      const hasActiveShift = typeof ch.shift === "number" && ch.shift !== 0;
      // With an active shift, an unset stored value starts from baseline; with
      // no shift there is nothing stored to decay.
      const current = typeof ch.stored === "number" ? ch.stored : hasActiveShift ? ch.base : null;
      if (current === null) continue;

      const next = hasActiveShift
        ? applyBandedShift(
            current,
            ch.base,
            ch.shift as number,
            ch.maxDeviation,
            ch.absMin,
            ch.absMax
          )
        : applyBaselineDecay(current, ch.base);

      // Only update if change is significant (same threshold as population)
      if (Math.abs(next - current) > MIN_CHANGE_THRESHOLD) {
        updates[`groups.${groupId}.${ch.field}`] = next;
      }
    }
  }

  return updates;
}

/** Clone a demographics doc and apply `groups.<id>.<field>` dot-path updates in memory. */
function cloneWithUpdates(
  demographics: StateDemographics,
  updates: Record<string, number>
): StateDemographics {
  const clone: StateDemographics = {
    ...demographics,
    groups: Object.fromEntries(
      Object.entries(demographics.groups).map(([id, g]) => [id, { ...g }])
    ),
  };
  for (const [path, value] of Object.entries(updates)) {
    const parts = path.split(".");
    if (parts.length === 3 && parts[0] === "groups") {
      const [, groupId, field] = parts;
      const group = clone.groups[groupId];
      if (group) {
        (group as unknown as Record<string, number>)[field] = value;
      }
    }
  }
  return clone;
}

/**
 * Recompute the cached derived leans after v2 updates. Mirrors the admin
 * demographics route writer: `calculateStateLean` over the updated doc, cached
 * onto both `stateDemographics` and `states`.
 * Returns null when the cache is already consistent.
 */
function computeCacheUpdate(
  demographics: StateDemographics,
  updates: Record<string, number>,
  categories: DemographicCategory[],
  context: {
    preset?: string | null;
    demographicDefaults?: StateDemographics | null;
    year?: number | null;
    startingYear?: number | null;
  }
): { economicLean: number; socialLean: number } | null {
  const updated = cloneWithUpdates(demographics, updates);
  const lean = calculateStateLeanForCache(updated, categories, {
    countryId: demographics.countryId,
    stateId: demographics._id,
    ...context,
  });
  if (
    demographics.cachedEconomicLean === lean.economicLean &&
    demographics.cachedSocialLean === lean.socialLean
  ) {
    return null;
  }
  return lean;
}

/**
 * Process demographic shifts for a single state
 * @param db - MongoDB database instance
 * @param stateId - The state ID (e.g., "CA", "TX")
 * @param legTypeMap - Pre-fetched map of legislation type IDs to documents (optional, for batch processing)
 */
export async function processStateDemographics(
  db: Db,
  stateId: string,
  legTypeMap?: LegislationTypeMap
): Promise<void> {
  const gameState = await db.collection<GameState>("gameState").findOne(
    { _id: "current" },
    {
      projection: {
        legislationDemographicEffectsV2Enabled: 1,
        preset: 1,
        currentYear: 1,
        startingYear: 1,
        eraSystemEnabled: 1,
      },
    }
  );
  const v2Enabled = isLegislationDemographicEffectsV2Enabled(gameState);

  // Get active policies for this state (includes federal policies)
  const policies = await getActivePoliciesForState(db, stateId);

  // Legacy fast-path: without v2 decay there is nothing to do for a
  // policy-less state.
  if (policies.length === 0 && !v2Enabled) {
    return;
  }

  // If no legTypeMap provided, fetch legislation types for this state's policies
  let effectiveLegTypeMap = legTypeMap;
  if (!effectiveLegTypeMap) {
    const legislationTypesCollection = db.collection<LegislationType>("legislationTypes");
    const uniqueLegTypeIds = [...new Set(policies.map((p) => p.legislationTypeId))];
    const legTypes = await legislationTypesCollection
      .find({ _id: { $in: uniqueLegTypeIds } })
      .toArray();

    effectiveLegTypeMap = new Map();
    for (const legType of legTypes) {
      effectiveLegTypeMap.set(legType._id, legType);
    }
  }

  // Get current demographics for this state
  const demographics = await db
    .collection<StateDemographics>("stateDemographics")
    .findOne({ _id: stateId });

  if (!demographics) {
    console.warn(`No demographics document found for state ${stateId}`);
    return;
  }

  // Calculate cumulative shifts from all policies
  const shifts = calculateDemographicShiftsByTarget(policies, effectiveLegTypeMap);

  let baselines: Map<string, DemographicGroupBaselines> | null = null;
  let categories: DemographicCategory[] = [];
  let stateDefaults: StateDemographics | null = null;
  if (v2Enabled) {
    const [cats, defaults] = await Promise.all([
      loadDemographicCategories(db),
      db.collection<StateDemographics>("demographicDefaults").findOne({ _id: stateId }),
    ]);
    categories = cats;
    stateDefaults = defaults;
    baselines = buildGroupBaselineMap(cats, defaults);
  }

  const updates = buildDemographicUpdates(demographics, shifts, baselines, v2Enabled);

  if (Object.keys(updates).length === 0) {
    return;
  }

  const cacheLean = v2Enabled
    ? computeCacheUpdate(demographics, updates, categories, {
        preset: gameState?.preset,
        demographicDefaults: stateDefaults,
        year: gameState?.eraSystemEnabled ? gameState.currentYear : null,
        startingYear: gameState?.startingYear,
      })
    : null;

  await db.collection<StateDemographics>("stateDemographics").updateOne(
    { _id: stateId },
    {
      $set: {
        ...updates,
        ...(cacheLean
          ? { cachedEconomicLean: cacheLean.economicLean, cachedSocialLean: cacheLean.socialLean }
          : {}),
        lastUpdated: new Date(),
      },
    }
  );

  if (cacheLean) {
    await db.collection<State>("states").updateOne(
      { _id: stateId },
      {
        $set: {
          cachedEconomicLean: cacheLean.economicLean,
          cachedSocialLean: cacheLean.socialLean,
          demographicsLastUpdated: new Date(),
        },
      }
    );
  }
}

/**
 * Process demographic effects for all states
 * @param db - MongoDB database instance
 * @returns number of states whose demographics were updated
 */
export async function processAllStateDemographics(db: Db): Promise<number> {
  // Bulk-fetch ALL data upfront in parallel (eliminates per-state queries)
  const [states, allStatePolicies, allLegTypes, allDemographics, gameState] = await Promise.all([
    db
      .collection<State>("states")
      .find({}, { projection: { _id: 1, countryId: 1 } })
      .toArray(),
    db
      .collection<import("@/lib/db/types/statePolicy").StatePolicy>("statePolicies")
      .find({})
      .toArray(),
    db.collection<LegislationType>("legislationTypes").find({}).toArray(),
    db.collection<StateDemographics>("stateDemographics").find({}).toArray(),
    db.collection<GameState>("gameState").findOne(
      { _id: "current" },
      {
        projection: {
          legislationDemographicEffectsV2Enabled: 1,
          preset: 1,
          currentYear: 1,
          startingYear: 1,
          eraSystemEnabled: 1,
        },
      }
    ),
  ]);

  const v2Enabled = isLegislationDemographicEffectsV2Enabled(gameState);

  // v2 needs the category templates (cache recompute + baseline fallback) and
  // the per-state seeded defaults (baseline source). Only fetched when the
  // flag is on, so flag-off turns issue no extra queries.
  let categories: DemographicCategory[] = [];
  let defaultsByState = new Map<string, StateDemographics>();
  if (v2Enabled) {
    const [cats, allDefaults] = await Promise.all([
      loadDemographicCategories(db),
      db.collection<StateDemographics>("demographicDefaults").find({}).toArray(),
    ]);
    categories = cats;
    defaultsByState = new Map(allDefaults.map((d) => [String(d._id), d]));
  }

  // Build legislation type map for O(1) lookups
  const legTypeMap: LegislationTypeMap = new Map();
  for (const legType of allLegTypes) {
    legTypeMap.set(legType._id, legType);
  }

  // Group policies by stateId
  const policiesByState = new Map<string, import("@/lib/db/types/statePolicy").StatePolicy[]>();
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

  // Build demographics lookup
  const demographicsMap = new Map(allDemographics.map((d) => [String(d._id), d]));

  // Process all states in-memory, collect DB updates
  const bulkOps: {
    updateOne: {
      filter: { _id: string };
      update: { $set: Record<string, number | Date> };
    };
  }[] = [];
  const stateCacheOps: {
    updateOne: {
      filter: { _id: string };
      update: { $set: Record<string, number | Date> };
    };
  }[] = [];
  // Durable ("permanent") legislation writes to `demographicDefaults` too —
  // see `DemographicEffect.permanent` and `durableRealignment.ts`.
  const defaultBulkOps: {
    updateOne: {
      filter: { _id: string };
      update: { $set: Record<string, number | Date> };
    };
  }[] = [];

  for (const state of states) {
    // Build combined policies for this state
    const nationalPoliciesMap: Record<string, ActivePolicy[]> = {
      US: federalPolicies,
      UK: ukNationalPolicies,
      JP: jpNationalPolicies,
      DE: deNationalPolicies,
    };
    const nationalPolicies = nationalPoliciesMap[state.countryId] ?? federalPolicies;
    const statePoliciesArray = policiesByState.get(state._id) ?? [];
    const stateWithMultiplier: ActivePolicy[] = statePoliciesArray.map((p) => ({
      ...p,
      scopeMultiplier: 1.0,
    }));
    const policies = [...stateWithMultiplier, ...nationalPolicies];

    // Legacy fast-path only: with v2 on, policy-less states still decay
    // toward baseline.
    if (policies.length === 0 && !v2Enabled) continue;

    const demographics = demographicsMap.get(state._id);
    if (!demographics) continue;

    // Calculate cumulative shifts from all policies. `shifts` (ALL effects)
    // still drives era-checkpoint counter-pressure elsewhere; the durable
    // ("permanent") subset is pulled out here so it stops going through the
    // capped/decaying temporary channel below and instead durably relocates
    // the base value via the shared mechanism (see `durableRealignment.ts`).
    const shifts = calculateDemographicShiftsByTarget(policies, legTypeMap);
    const durableShifts = v2Enabled
      ? calculateDurableDemographicShiftsByTarget(policies, legTypeMap)
      : { population: {}, economicLean: {}, socialLean: {}, turnout: {} };
    const temporaryShifts = subtractDurableShifts(shifts, durableShifts);

    const stateDefaults = defaultsByState.get(state._id);
    const baselines = v2Enabled ? buildGroupBaselineMap(categories, stateDefaults) : null;

    const temporaryUpdates = buildDemographicUpdates(
      demographics,
      temporaryShifts,
      baselines,
      v2Enabled
    );

    // Durable channel: seed its live-update accumulator with whatever the
    // temporary channel already computed this turn (banded shift OR decay)
    // so a durable delta STACKS on top of it rather than clobbering it when
    // a group has both a durable and an ordinary effect active on the same
    // axis in the same turn.
    const durableAcc: DurableShiftAccumulators = {
      liveUpdates: { ...temporaryUpdates },
      defaultUpdates: {},
    };
    if (v2Enabled) {
      for (const axis of ["economicLean", "socialLean"] as const) {
        for (const [groupId, netDelta] of Object.entries(durableShifts[axis])) {
          if (!netDelta) continue;
          const currentLive = demographics.groups[groupId]?.[axis];
          if (typeof currentLive !== "number") continue;
          applyDurableGroupShift(
            groupId,
            axis,
            netDelta,
            {
              live: currentLive,
              default: stateDefaults?.groups[groupId]?.[axis],
              readOverlay: (dim, bucket) => readLayer1Overlay(stateDefaults, dim, bucket, axis),
            },
            durableAcc,
            state.countryId
          );
        }
      }
      // Durable TURNOUT — the Voting Rights Act's enfranchisement channel.
      // Separate loop (not folded into the lean loop above) because it routes
      // through `applyDurableGroupTurnoutShift`'s own clamp/overlay
      // (`layer1TurnoutOverrides`), not the lean channel's — see
      // `DemographicEffect.permanent`'s doc comment.
      for (const [groupId, netDelta] of Object.entries(durableShifts.turnout)) {
        if (!netDelta) continue;
        const currentLive = demographics.groups[groupId]?.turnout;
        if (typeof currentLive !== "number") continue;
        applyDurableGroupTurnoutShift(
          groupId,
          netDelta,
          {
            live: currentLive,
            default: stateDefaults?.groups[groupId]?.turnout,
            readOverlay: (dim, bucket) => readLayer1TurnoutOverlay(stateDefaults, dim, bucket),
          },
          durableAcc,
          state.countryId
        );
      }
    }
    const updates = durableAcc.liveUpdates;
    const durableDefaultUpdates = durableAcc.defaultUpdates;

    if (Object.keys(updates).length > 0) {
      const cacheLean = v2Enabled
        ? computeCacheUpdate(demographics, updates, categories, {
            preset: gameState?.preset,
            demographicDefaults: stateDefaults,
            year: gameState?.eraSystemEnabled ? gameState.currentYear : null,
            startingYear: gameState?.startingYear,
          })
        : null;
      bulkOps.push({
        updateOne: {
          filter: { _id: state._id },
          update: {
            $set: {
              ...updates,
              ...(cacheLean
                ? {
                    cachedEconomicLean: cacheLean.economicLean,
                    cachedSocialLean: cacheLean.socialLean,
                  }
                : {}),
              lastUpdated: new Date(),
            },
          },
        },
      });
      if (cacheLean) {
        // Mirror the admin-route cache writer: `states` keeps a copy of the
        // derived leans for quick map/primary reads.
        stateCacheOps.push({
          updateOne: {
            filter: { _id: state._id },
            update: {
              $set: {
                cachedEconomicLean: cacheLean.economicLean,
                cachedSocialLean: cacheLean.socialLean,
                demographicsLastUpdated: new Date(),
              },
            },
          },
        });
      }
    }
    if (Object.keys(durableDefaultUpdates).length > 0) {
      defaultBulkOps.push({
        updateOne: {
          filter: { _id: state._id },
          update: { $set: { ...durableDefaultUpdates, lastUpdated: new Date() } },
        },
      });
    }
  }

  // Single bulkWrite instead of N individual updateOne calls
  if (bulkOps.length > 0) {
    await db.collection<StateDemographics>("stateDemographics").bulkWrite(bulkOps);
  }
  if (stateCacheOps.length > 0) {
    await db.collection<State>("states").bulkWrite(stateCacheOps);
  }
  if (defaultBulkOps.length > 0) {
    await db.collection<StateDemographics>("demographicDefaults").bulkWrite(defaultBulkOps);
  }

  return bulkOps.length;
}
