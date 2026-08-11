/**
 * SEED INDEPENDENCE — DO NOT DERIVE FROM ANOTHER ERA.
 * Each era seed is self-contained. This file MUST NOT import and transform
 * another era's registration builders. All values are authored for 2007
 * directly. Type-only imports are allowed.
 */

/**
 * US party registration + organization seed for the 2007-default preset.
 *
 * Anchored to the 2004–2006 state registration landscape and the 2008
 * presidential result (the era's election oracle). Key 2007-era characteristics
 * vs the 2023 seed:
 *
 *   - Independents/unaffiliated run LOWER (~13–15 pts vs ~16–22 in 2023) — the
 *     big de-alignment surge is mostly post-2008. Formal party registration is
 *     correspondingly higher.
 *   - The "ancestral Democrat" South: WV, KY, LA, OK (and registration-less AR)
 *     still carried majority *Democratic registration* in 2007 even as they
 *     voted Republican federally — encoded as DEM reg > REP reg but a Republican
 *     org/lean edge (override states below).
 *   - VA, NC, FL, OH, IN are competitive/leanR here (the 2008 Obama coalition
 *     flipped several only that cycle); CO/NV/NH still competitive.
 *
 * US-only: non-US countries fall back to their 2019 lanes on a 2007 reset.
 * Curated from state SoS 2006–07 registration data + 2008 election results.
 */

import type { StateRegistrationSeed } from "./registrationLanes";

// ─── 2007 US lane templates ──────────────────────────────────────────────────
const US_LANES_2007 = {
  strongD: {
    parties: [
      { abbr: "DEM", org: 38, reg: 54 },
      { abbr: "REP", org: 20, reg: 26 },
    ],
    independent: 13,
    unregistered: 7,
    unaffiliatedOrg: 42,
  },
  solidD: {
    parties: [
      { abbr: "DEM", org: 35, reg: 49 },
      { abbr: "REP", org: 23, reg: 32 },
    ],
    independent: 13,
    unregistered: 7,
    unaffiliatedOrg: 42,
  },
  leanD: {
    parties: [
      { abbr: "DEM", org: 32, reg: 44 },
      { abbr: "REP", org: 26, reg: 35 },
    ],
    independent: 14,
    unregistered: 7,
    unaffiliatedOrg: 42,
  },
  competitiveD: {
    parties: [
      { abbr: "DEM", org: 30, reg: 40 },
      { abbr: "REP", org: 28, reg: 38 },
    ],
    independent: 14,
    unregistered: 8,
    unaffiliatedOrg: 42,
  },
  competitiveR: {
    parties: [
      { abbr: "DEM", org: 28, reg: 38 },
      { abbr: "REP", org: 30, reg: 40 },
    ],
    independent: 14,
    unregistered: 8,
    unaffiliatedOrg: 42,
  },
  leanR: {
    parties: [
      { abbr: "DEM", org: 26, reg: 35 },
      { abbr: "REP", org: 32, reg: 44 },
    ],
    independent: 14,
    unregistered: 7,
    unaffiliatedOrg: 42,
  },
  solidR: {
    parties: [
      { abbr: "DEM", org: 23, reg: 32 },
      { abbr: "REP", org: 35, reg: 49 },
    ],
    independent: 13,
    unregistered: 7,
    unaffiliatedOrg: 42,
  },
  strongR: {
    parties: [
      { abbr: "DEM", org: 20, reg: 27 },
      { abbr: "REP", org: 38, reg: 53 },
    ],
    independent: 13,
    unregistered: 7,
    unaffiliatedOrg: 42,
  },
} as const;

// Lane assignments — anchored to the 2008 presidential map with 2007-era
// registration. Several states sit a notch more Republican than their 2023 cell
// (VA/NC/CO pre-Obama-realignment).
const US_ASSIGNMENTS_2007: Record<keyof typeof US_LANES_2007, string[]> = {
  strongD: ["CA", "HI", "MA", "MD", "NY", "VT", "RI"],
  solidD: ["CT", "DE", "IL", "NJ", "WA", "OR", "ME"],
  leanD: ["MN", "MI", "WI", "PA", "NM"],
  competitiveD: ["IA", "NH", "NV", "CO"],
  competitiveR: ["OH", "VA", "FL", "NC", "IN"],
  leanR: ["MO", "MT", "GA", "AZ"],
  solidR: ["KY", "LA", "SC", "TN", "WV", "ND", "SD", "KS", "NE", "AR"],
  strongR: ["AL", "ID", "MS", "OK", "WY"],
};

// Per-state overrides — registration-less states, large-unaffiliated states, and
// the ancestral-Democrat South (DEM reg edge but Republican org/lean).
const US_OVERRIDES_2007: Record<string, Omit<StateRegistrationSeed, "countryId" | "stateId">> = {
  // DC: 2008 Obama 92.5% / McCain 6.5% — most Democratic jurisdiction.
  DC: {
    parties: [
      { abbr: "DEM", org: 44, reg: 78 },
      { abbr: "REP", org: 6, reg: 6 },
    ],
    independent: 8,
    unregistered: 8,
    unaffiliatedOrg: 50,
  },
  // AK: Large unaffiliated bloc; non-partisan/undeclared the biggest group.
  AK: {
    parties: [
      { abbr: "DEM", org: 18, reg: 25 },
      { abbr: "REP", org: 28, reg: 36 },
    ],
    independent: 24,
    unregistered: 11,
    unaffiliatedOrg: 53,
  },
  // UT: strongR but a large unaffiliated/undeclared pool (LDS community).
  UT: {
    parties: [
      { abbr: "DEM", org: 14, reg: 18 },
      { abbr: "REP", org: 34, reg: 46 },
    ],
    independent: 24,
    unregistered: 11,
    unaffiliatedOrg: 53,
  },
  // TX: no party registration; org/lean reflects a Republican 2007 baseline.
  TX: {
    parties: [
      { abbr: "DEM", org: 27, reg: 36 },
      { abbr: "REP", org: 31, reg: 41 },
    ],
    independent: 14,
    unregistered: 8,
    unaffiliatedOrg: 42,
  },
  // WV: ~55% Democratic registration in 2007 yet voted McCain — ancestral D reg,
  // Republican org edge.
  WV: {
    parties: [
      { abbr: "DEM", org: 27, reg: 53 },
      { abbr: "REP", org: 30, reg: 30 },
    ],
    independent: 9,
    unregistered: 8,
    unaffiliatedOrg: 42,
  },
  // KY: ~57% Democratic registration in 2007, voted McCain — ancestral D reg.
  KY: {
    parties: [
      { abbr: "DEM", org: 28, reg: 56 },
      { abbr: "REP", org: 31, reg: 36 },
    ],
    independent: 8,
    unregistered: 7,
    unaffiliatedOrg: 42,
  },
  // LA: closed-primary registration; ~52% Democratic in 2007, voted McCain.
  LA: {
    parties: [
      { abbr: "DEM", org: 26, reg: 51 },
      { abbr: "REP", org: 31, reg: 27 },
    ],
    independent: 12,
    unregistered: 8,
    unaffiliatedOrg: 42,
  },
  // OK: ~49% Democratic registration in 2007, voted McCain (every county) —
  // the sharpest ancestral-D-reg vs Republican-vote split in the country.
  OK: {
    parties: [
      { abbr: "DEM", org: 24, reg: 48 },
      { abbr: "REP", org: 33, reg: 39 },
    ],
    independent: 8,
    unregistered: 7,
    unaffiliatedOrg: 42,
  },
};

function buildUSSeeds2007(): StateRegistrationSeed[] {
  const seeds: StateRegistrationSeed[] = [];

  for (const [lane, states] of Object.entries(US_ASSIGNMENTS_2007) as Array<
    [keyof typeof US_LANES_2007, string[]]
  >) {
    const template = US_LANES_2007[lane];
    for (const stateId of states) {
      const override = US_OVERRIDES_2007[stateId];
      seeds.push({
        countryId: "US",
        stateId,
        parties: (override ?? template).parties.map((p) => ({ ...p })),
        independent: (override ?? template).independent,
        unregistered: (override ?? template).unregistered,
        unaffiliatedOrg: (override ?? template).unaffiliatedOrg,
      });
    }
  }

  // Add override-only states not covered by any lane assignment.
  for (const [stateId, override] of Object.entries(US_OVERRIDES_2007)) {
    if (seeds.some((s) => s.stateId === stateId)) continue;
    seeds.push({
      countryId: "US",
      stateId,
      parties: override.parties.map((p) => ({ ...p })),
      independent: override.independent,
      unregistered: override.unregistered,
      unaffiliatedOrg: override.unaffiliatedOrg,
    });
  }

  return seeds;
}

/**
 * Returns the US 2007-default registration / org seed bundle.
 * US-only: non-US countries in the 2007 preset fall back to their 2019 data.
 */
export function build2007RegistrationSeeds(): StateRegistrationSeed[] {
  return buildUSSeeds2007();
}
