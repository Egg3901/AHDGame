/**
 * Presidential primary calendar + delegate tables.
 *
 * During the final 6 turns of a presidential primary, states vote in waves
 * modeled on the real 2020 US primary calendars:
 *
 *   Wave 1 (T-5): Iowa caucus
 *   Wave 2 (T-4): New Hampshire
 *   Wave 3 (T-3): Nevada + South Carolina
 *   Wave 4 (T-2): Super Tuesday (14 states)
 *   Wave 5 (T-1): mid-March states
 *   Wave 6 (T-0): all remaining
 *
 * Both the Dem-family calendar and the GOP-family calendar share the same
 * wave structure in 2020 because the early-state windows matched. If they
 * diverge for a future cycle, split into two tables.
 *
 * Delegate counts are the real 2020 pledged delegate totals (Dem) and the
 * 2020 Republican state allocations (GOP). They rescale at primary-cycle
 * init if a state's EV count has changed from its 2020 baseline.
 */

import { getElectoralVotes } from "@/lib/constants/states";
import type { AllocationMethod } from "@/lib/primaryDelegateAllocation";
import type { PresidentialRuleset } from "@/lib/elections/presidentialRuleset";
import {
  PRIMARY_WAVES,
  DEM_2020_DELEGATES,
  GOP_2020_DELEGATES,
  EV_2020_BASELINE,
  GOP_DEFAULT_ALLOCATION,
  BUILTIN_PARTY_FAMILY,
} from "@/lib/countries/us/data/usPrimaryCalendar";

/** Party family — determines which calendar + delegate count the candidate's party uses. */
export type PrimaryCalendarFamily = "dem" | "gop";

/** A wave is one turn during the stagger window. */
export interface PrimaryWave {
  /** Turns remaining in the primary when this wave fires. Wave 1 fires at T-5 (5 turns before primary end). */
  turnsRemaining: number;
  /** State IDs voting this turn. */
  states: string[];
  /** Human label for UI. */
  label: string;
}

/** Number of stagger turns before primaryEndTime. */
export const STAGGER_WINDOW_TURNS = 6;

/**
 * Stretched wave schedule — the SAME six waves with IDENTICAL state membership,
 * but spaced across the primary window so each wave's result lands with turns to
 * spare before the next. The compressed table bunches all six into the final six
 * turns (the audited defect where a whole primary resolved in one burst with no
 * reaction gap). Only the `turnsRemaining` offsets differ; the union of states is
 * byte-for-byte the same, so every downstream consumer that reads state
 * membership (delegate tables, projections, UI carve-up) is unchanged.
 */
export const PRIMARY_WAVES_STRETCHED: PrimaryWave[] = PRIMARY_WAVES.map((wave, index) => ({
  ...wave,
  states: [...wave.states],
  turnsRemaining: [40, 32, 24, 16, 8, 0][index],
}));

/** Number of stagger turns before primaryEndTime for the stretched calendar (max offset + 1). */
export const STAGGER_WINDOW_TURNS_STRETCHED = 41;

/** A resolved wave table plus its stagger-window size. */
export interface PrimaryWaveSchedule {
  kind: "compressed" | "stretched";
  waves: PrimaryWave[];
  windowTurns: number;
}

/** Compressed calendar (v1/v2 live behavior): six waves in the final six turns. */
export const COMPRESSED_SCHEDULE: PrimaryWaveSchedule = {
  kind: "compressed",
  waves: PRIMARY_WAVES,
  windowTurns: STAGGER_WINDOW_TURNS,
};

/** Stretched calendar: same waves spaced across the primary window. */
export const STRETCHED_SCHEDULE: PrimaryWaveSchedule = {
  kind: "stretched",
  waves: PRIMARY_WAVES_STRETCHED,
  windowTurns: STAGGER_WINDOW_TURNS_STRETCHED,
};

/**
 * Resolve the schedule a primary is ACTUALLY on from the turnsRemaining its
 * first wave was recorded at, independent of the race's current ruleset stamp.
 *
 * A primary keeps the cadence it opened on: a race whose first wave fired at
 * the compressed lead (turnsRemaining `STAGGER_WINDOW_TURNS - 1`) is mid-flight
 * on the compressed table, and re-stamping it to a stretched ruleset must NOT
 * switch it (the stretched waves would all fall due at once because the
 * 40-turn lead is already gone). Returns null when the recorded offset matches
 * neither schedule's first wave, so callers fall back to the ruleset schedule.
 */
export function startedScheduleForFirstOffset(
  firstWaveTurnsRemaining: number | null | undefined
): PrimaryWaveSchedule | null {
  if (firstWaveTurnsRemaining == null) return null;
  if (firstWaveTurnsRemaining === COMPRESSED_SCHEDULE.waves[0]?.turnsRemaining) {
    return COMPRESSED_SCHEDULE;
  }
  if (firstWaveTurnsRemaining === STRETCHED_SCHEDULE.waves[0]?.turnsRemaining) {
    return STRETCHED_SCHEDULE;
  }
  return null;
}

/**
 * Resolve which wave schedule a race runs from its ruleset. "stretched" only
 * applies to races spawned under the version that sets it; every unstamped or
 * pre-rework race stays on the compressed table (identical to prior behavior).
 */
export function getPrimaryWaveSchedule(
  ruleset: Pick<PresidentialRuleset, "primaryCalendar">
): PrimaryWaveSchedule {
  return ruleset.primaryCalendar === "stretched" ? STRETCHED_SCHEDULE : COMPRESSED_SCHEDULE;
}

/**
 * Return the wave that fires when `turnsRemaining` turns are left in the primary.
 * Returns null outside the schedule's stagger window. Defaults to the compressed
 * schedule so existing callers keep their behavior.
 */
export function getWaveForTurnsRemaining(
  turnsRemaining: number,
  schedule: PrimaryWaveSchedule = COMPRESSED_SCHEDULE
): PrimaryWave | null {
  if (turnsRemaining < 0 || turnsRemaining > schedule.windowTurns - 1) return null;
  return schedule.waves.find((w) => w.turnsRemaining === turnsRemaining) ?? null;
}

/**
 * Flatten all wave states. Used to sanity-check every state is assigned. State
 * membership is identical across schedules, so the default compressed schedule
 * yields the same set as the stretched one.
 */
export function getAllStaggerStates(schedule: PrimaryWaveSchedule = COMPRESSED_SCHEDULE): string[] {
  return schedule.waves.flatMap((w) => w.states);
}

/**
 * Compute the current delegate count for a state + family, rescaling by EV change
 * from the 2020 baseline. Returns the 2020 baseline if EV is unchanged or missing.
 */
export function getDelegatesForState(
  stateId: string,
  family: PrimaryCalendarFamily,
  preset?: string
): number {
  const baseline = family === "dem" ? DEM_2020_DELEGATES[stateId] : GOP_2020_DELEGATES[stateId];
  if (!baseline) return 0;

  const ev2020 = EV_2020_BASELINE[stateId];
  const evCurrent = getElectoralVotes(preset)[stateId];
  if (!ev2020 || !evCurrent || ev2020 === evCurrent) return baseline;

  // Rescale proportionally, minimum 1 delegate to avoid zeroing small states
  return Math.max(1, Math.round(baseline * (evCurrent / ev2020)));
}

/**
 * Total pledged delegates for a party family given the active preset's EV
 * apportionment. Used to compute the majority threshold at resolution time.
 */
export function getTotalDelegatesForFamily(family: PrimaryCalendarFamily, preset?: string): number {
  const all = family === "dem" ? DEM_2020_DELEGATES : GOP_2020_DELEGATES;
  let total = 0;
  for (const stateId of Object.keys(all)) {
    total += getDelegatesForState(stateId, family, preset);
  }
  return total;
}

/** Majority threshold for a family (half of total + 1). */
export function getDelegateMajority(family: PrimaryCalendarFamily, preset?: string): number {
  return Math.floor(getTotalDelegatesForFamily(family, preset) / 2) + 1;
}

// ─── Real-world per-state allocation defaults ───────────────────────────────
//
// Best-effort classification of how each state actually allocates pledged
// delegates in a presidential primary, used as the FALLBACK when a state's
// chair has not set `StatePartyOrg.primaryAllocation` explicitly.
//
//   * Dem family — DNC Rule 14 mandates proportional allocation with a 15%
//     viability threshold across every state and territory. Every state is
//     "PR".
//   * GOP family — RNC Rule 16 lets each state party pick its own allocation
//     style. The 2024 cycle had a mix of statewide WTA, statewide proportional,
//     and hybrid (statewide PR + winner-take-all per congressional district).
//     For the simple 2-method dispatch (`AllocationMethod = "PR" | "WTA"`),
//     hybrid states are mapped to whichever rule dominates outcomes for the
//     statewide pool — closest single-method approximation.
//
// This is intentionally not exhaustive: states with caucuses or open
// conventions, US territories, and split CD-allocated delegates are simplified
// to a single method. State chairs can override per-state from the country
// region UI; that override always wins.

/**
 * Resolve the default allocation method for a state + party family, BEFORE
 * applying any per-state override from `StatePartyOrg.primaryAllocation`.
 *
 *   * dem family → always "PR" (DNC Rule 14).
 *   * gop family → looks up `GOP_DEFAULT_ALLOCATION` for a real-world rule;
 *     falls back to "WTA" for any state not in the map (mirrors the prior
 *     behaviour, so unknown / synthetic states keep working).
 *
 * Callers that have a per-state override should prefer the override and only
 * use this as a fallback. See `summarizePrimaryProjection` /
 * `projectPrimaryDelegateTotals` for the standard precedence.
 */
export function getDefaultPrimaryAllocation(
  stateId: string,
  family: PrimaryCalendarFamily
): AllocationMethod {
  if (family === "dem") return "PR";
  return GOP_DEFAULT_ALLOCATION[stateId] ?? "WTA";
}

/**
 * Resolve which calendar a party follows.
 *
 * Precedence:
 *   1. Built-in party id (democrat, republican, etc.)
 *   2. Explicit `primaryCalendar` field on the PoliticalParty doc
 *   3. Inferred from economic position sign (< 0 → dem, >= 0 → gop)
 *
 * Independents do not have primaries — they skip the primary phase entirely.
 */
export function resolvePartyFamily(
  partyId: string,
  options: { primaryCalendar?: PrimaryCalendarFamily | null; economicPosition?: number | null } = {}
): PrimaryCalendarFamily {
  const builtin = BUILTIN_PARTY_FAMILY[partyId];
  if (builtin) return builtin;

  if (options.primaryCalendar === "dem" || options.primaryCalendar === "gop") {
    return options.primaryCalendar;
  }

  const ep = options.economicPosition ?? 0;
  return ep < 0 ? "dem" : "gop";
}

/**
 * The United States' calendar and delegate tables, which now live in its country
 * folder.
 *
 * ⚠️ A FORWARDER HOLDS NO COPY. Re-exported so every consumer of this module
 * -- primaryStaggerPhase, primaryViewModel, conventionResolution, the president
 * primary pages -- is untouched, and so there is exactly one definition of each
 * table. The functions above read them through these bindings.
 */
export {
  PRIMARY_WAVES,
  DEM_2020_DELEGATES,
  GOP_2020_DELEGATES,
  EV_2020_BASELINE,
  GOP_DEFAULT_ALLOCATION,
  GOP_HYBRID_STATES,
  BUILTIN_PARTY_FAMILY,
} from "@/lib/countries/us/data/usPrimaryCalendar";
