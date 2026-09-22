import type { AllocationMethod } from "@/lib/primaryDelegateAllocation";
import type { PrimaryCalendarFamily, PrimaryWave } from "@/lib/constants/primaryCalendar";

/**
 * The United States' presidential primary calendar and delegate tables.
 *
 * \u26a0\ufe0f THIS IS DATA ABOUT ONE COUNTRY, AND IT LOOKED LIKE ENGINE CONFIGURATION.
 * `PRIMARY_WAVES` is the 2020 US calendar -- the Iowa caucus, the New Hampshire
 * primary, Super Tuesday. `DEM_2020_DELEGATES`, `GOP_2020_DELEGATES` and
 * `EV_2020_BASELINE` are keyed by state, and `BUILTIN_PARTY_FAMILY` maps DEM and
 * REP. None of it describes a mechanic; all of it describes the United States.
 *
 * The staggered-primary ENGINE stays in `constants/primaryCalendar.ts`:
 * `PrimaryWaveSchedule`, `getPrimaryWaveSchedule`, `getWaveForTurnsRemaining`,
 * `getDelegateMajority` and `resolvePartyFamily` are read by
 * `primaryStaggerPhase` and `conventionResolution`, which default to `"US"` but
 * are not about it. That file re-exports everything below, so no consumer moved.
 *
 * \u26a0\ufe0f THE TYPE IMPORTS POINT BACK AT THE ENGINE AND THAT IS FINE. Type-only
 * imports are erased, so this is not a runtime cycle. A VALUE import back out of
 * `constants/primaryCalendar.ts` would be one, and would fail on module-init
 * order rather than at build time.
 */

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
