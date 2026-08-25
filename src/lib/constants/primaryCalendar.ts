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
 * Shared wave schedule — 2020 Dem and 2020 GOP early calendars lined up,
 * so we use one table. If they diverge in a future cycle, fork this.
 */
export const PRIMARY_WAVES: PrimaryWave[] = [
  {
    turnsRemaining: 5,
    states: ["IA"],
    label: "Iowa Caucus",
  },
  {
    turnsRemaining: 4,
    states: ["NH"],
    label: "New Hampshire Primary",
  },
  {
    turnsRemaining: 3,
    states: ["NV", "SC"],
    label: "Nevada + South Carolina",
  },
  {
    turnsRemaining: 2,
    states: ["AL", "AR", "CA", "CO", "ME", "MA", "MN", "NC", "OK", "TN", "TX", "UT", "VT", "VA"],
    label: "Super Tuesday",
  },
  {
    turnsRemaining: 1,
    states: ["AZ", "FL", "ID", "IL", "MI", "MS", "MO", "ND", "OH", "WA"],
    label: "Mid-March Wave",
  },
  {
    turnsRemaining: 0,
    states: [
      "AK",
      "CT",
      "DC",
      "DE",
      "GA",
      "HI",
      "IN",
      "KS",
      "KY",
      "LA",
      "MD",
      "MT",
      "NE",
      "NJ",
      "NM",
      "NY",
      "OR",
      "PA",
      "RI",
      "SD",
      "WV",
      "WI",
      "WY",
    ],
    label: "Closing Wave",
  },
];

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
  waves: PrimaryWave[];
  windowTurns: number;
}

/** Compressed calendar (v1/v2 live behavior): six waves in the final six turns. */
export const COMPRESSED_SCHEDULE: PrimaryWaveSchedule = {
  waves: PRIMARY_WAVES,
  windowTurns: STAGGER_WINDOW_TURNS,
};

/** Stretched calendar: same waves spaced across the primary window. */
export const STRETCHED_SCHEDULE: PrimaryWaveSchedule = {
  waves: PRIMARY_WAVES_STRETCHED,
  windowTurns: STAGGER_WINDOW_TURNS_STRETCHED,
};

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
 * Dem family 2020 pledged-delegate counts per state.
 * Total: 3,979 pledged delegates. Majority: 1,991.
 * Source: DNC 2020 pledged-delegate allocation.
 */
export const DEM_2020_DELEGATES: Record<string, number> = {
  AL: 52,
  AK: 15,
  AZ: 67,
  AR: 31,
  CA: 415,
  CO: 67,
  CT: 60,
  DC: 20,
  DE: 21,
  FL: 219,
  GA: 105,
  HI: 24,
  ID: 20,
  IL: 155,
  IN: 82,
  IA: 41,
  KS: 39,
  KY: 54,
  LA: 54,
  ME: 24,
  MD: 96,
  MA: 91,
  MI: 125,
  MN: 75,
  MS: 36,
  MO: 68,
  MT: 19,
  NE: 29,
  NV: 36,
  NH: 24,
  NJ: 126,
  NM: 34,
  NY: 274,
  NC: 110,
  ND: 14,
  OH: 136,
  OK: 37,
  OR: 61,
  PA: 186,
  RI: 26,
  SC: 54,
  SD: 16,
  TN: 64,
  TX: 228,
  UT: 29,
  VT: 16,
  VA: 99,
  WA: 89,
  WV: 28,
  WI: 84,
  WY: 14,
};

/**
 * GOP 2020 state delegate counts. 2020 was largely uncontested so the
 * structure follows 2016 proportions, scaled to 2020 EV apportionment.
 * Total: 2,551 delegates. Majority: 1,276.
 */
export const GOP_2020_DELEGATES: Record<string, number> = {
  AL: 50,
  AK: 28,
  AZ: 57,
  AR: 40,
  CA: 172,
  CO: 37,
  CT: 28,
  DC: 19,
  DE: 16,
  FL: 122,
  GA: 76,
  HI: 19,
  ID: 32,
  IL: 67,
  IN: 58,
  IA: 40,
  KS: 39,
  KY: 46,
  LA: 46,
  ME: 22,
  MD: 38,
  MA: 41,
  MI: 73,
  MN: 39,
  MS: 40,
  MO: 54,
  MT: 27,
  NE: 36,
  NV: 25,
  NH: 22,
  NJ: 49,
  NM: 22,
  NY: 94,
  NC: 71,
  ND: 29,
  OH: 82,
  OK: 43,
  OR: 28,
  PA: 88,
  RI: 19,
  SC: 50,
  SD: 29,
  TN: 58,
  TX: 155,
  UT: 40,
  VT: 17,
  VA: 49,
  WA: 43,
  WV: 34,
  WI: 52,
  WY: 29,
};

/**
 * 2020 electoral vote apportionment. Used as the denominator for EV-rescaling:
 * if a state's current EV count differs from its 2020 baseline, we rescale
 * delegates by (currentEV / ev2020) at primary-cycle init.
 */
export const EV_2020_BASELINE: Record<string, number> = {
  AL: 9,
  AK: 3,
  AZ: 11,
  AR: 6,
  CA: 55,
  CO: 9,
  CT: 7,
  DC: 3,
  DE: 3,
  FL: 29,
  GA: 16,
  HI: 4,
  ID: 4,
  IL: 20,
  IN: 11,
  IA: 6,
  KS: 6,
  KY: 8,
  LA: 8,
  ME: 4,
  MD: 10,
  MA: 11,
  MI: 16,
  MN: 10,
  MS: 6,
  MO: 10,
  MT: 3,
  NE: 5,
  NV: 6,
  NH: 4,
  NJ: 14,
  NM: 5,
  NY: 29,
  NC: 15,
  ND: 3,
  OH: 18,
  OK: 7,
  OR: 7,
  PA: 20,
  RI: 4,
  SC: 9,
  SD: 3,
  TN: 11,
  TX: 38,
  UT: 6,
  VT: 3,
  VA: 13,
  WA: 12,
  WV: 5,
  WI: 10,
  WY: 3,
};

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
 * Statewide allocation rule used for Republican primaries when a state has
 * not set its own override on `StatePartyOrg.primaryAllocation`. Reflects the
 * 2024 cycle's published rules (RNC + state party rule books) collapsed to a
 * single statewide method per state.
 *
 * Hybrid (PR + per-CD WTA) states are listed in `GOP_HYBRID_STATES` for UI
 * disclosure even though they're collapsed to one method here.
 */
export const GOP_DEFAULT_ALLOCATION: Record<string, AllocationMethod> = {
  // ── Statewide winner-take-all (plurality leader takes everything) ─────────
  AZ: "WTA",
  DE: "WTA",
  FL: "WTA",
  ID: "WTA",
  IN: "WTA",
  KS: "WTA", // bound caucus → WTA when threshold met
  KY: "WTA",
  MS: "WTA", // statewide WTA at 50%, otherwise PR — modeled as WTA per common case
  MT: "WTA",
  ND: "WTA",
  NE: "WTA",
  NJ: "WTA",
  NV: "WTA", // 2024 caucus → WTA in practice
  OH: "WTA",
  OK: "WTA",
  SC: "WTA",
  SD: "WTA",
  WV: "WTA", // statewide WTA when leader > 50%
  WY: "WTA",

  // ── Hybrid: statewide PR + per-CD WTA, modeled as PR for the statewide pool
  // (CD-level WTA isn't represented in the 2-method system). ────────────────
  AL: "PR",
  AR: "PR",
  CA: "PR",
  GA: "PR",
  IL: "PR",
  MI: "PR",
  MO: "PR",
  NC: "PR",
  NY: "PR",
  PA: "PR",
  TN: "PR",
  TX: "PR",
  UT: "PR",
  VA: "PR",
  WI: "PR",

  // ── Pure proportional ────────────────────────────────────────────────────
  AK: "PR",
  CO: "PR",
  CT: "PR",
  DC: "PR",
  HI: "PR",
  IA: "PR", // non-binding caucus straw poll, allocated proportionally
  LA: "PR",
  MA: "PR",
  MD: "PR",
  ME: "PR",
  MN: "PR",
  NH: "PR", // proportional with 10% threshold
  NM: "PR",
  OR: "PR",
  RI: "PR",
  VT: "PR",
  WA: "PR",
};

/**
 * GOP states with hybrid statewide-PR + per-CD WTA rules. Their statewide
 * allocation is collapsed to PR in `GOP_DEFAULT_ALLOCATION`, but UI can flag
 * them so the user knows the approximation.
 */
export const GOP_HYBRID_STATES: ReadonlySet<string> = new Set([
  "AL",
  "AR",
  "CA",
  "GA",
  "IL",
  "MI",
  "MO",
  "NC",
  "NY",
  "PA",
  "TN",
  "TX",
  "UT",
  "VA",
  "WI",
]);

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
 * Built-in party family assignments for known 2020 parties.
 * Custom parties fall back to `primaryCalendar` field on PoliticalParty or
 * inferred from economic position sign (`economicPosition < 0 → "dem"`).
 */
export const BUILTIN_PARTY_FAMILY: Record<string, PrimaryCalendarFamily> = {
  democrat: "dem",
  green: "dem",
  progressive: "dem",
  "dem-socialist": "dem",
  republican: "gop",
  libertarian: "gop",
  reform: "gop",
};

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
