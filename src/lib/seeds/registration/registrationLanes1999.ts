/**
 * SEED INDEPENDENCE — DO NOT DERIVE FROM ANOTHER ERA.
 * Each era seed is self-contained. This file MUST NOT import and transform
 * another era's registration builders. All values are authored for 1999
 * directly. Type-only imports are allowed.
 */

/**
 * US party registration + organization seed for the 1999-default preset.
 *
 * Anchored to the 1998–2000 registration landscape and the 2000 Gore–Bush
 * result (the era's election oracle). 1999-era characteristics:
 *   - Independents/unaffiliated at their LOWEST (~10–12 pts) — the de-alignment
 *     surge is entirely later. Formal party registration is correspondingly high.
 *   - The ancestral-Democrat South is at its strongest: WV/KY/LA/OK carried
 *     roughly 55–62% Democratic *registration* in 1999 even while trending
 *     Republican federally (override states below).
 *   - 2000 was a near-tie nationally: FL/NH/OH/MO/NV/TN are competitiveR;
 *     WI/IA/OR/NM are competitiveD (Gore won each by <1 pt).
 *
 * US-only: non-US countries fall back to their 2019 lanes on a 1999 reset.
 * Curated from state SoS 1998–2000 registration data + 2000 election results.
 */

import type { StateRegistrationSeed } from "./registrationLanes";

const US_LANES_1999 = {
  strongD: {
    parties: [
      { abbr: "DEM", org: 39, reg: 58 },
      { abbr: "REP", org: 19, reg: 25 },
    ],
    independent: 11,
    unregistered: 6,
    unaffiliatedOrg: 41,
  },
  solidD: {
    parties: [
      { abbr: "DEM", org: 36, reg: 52 },
      { abbr: "REP", org: 22, reg: 31 },
    ],
    independent: 11,
    unregistered: 6,
    unaffiliatedOrg: 41,
  },
  leanD: {
    parties: [
      { abbr: "DEM", org: 33, reg: 47 },
      { abbr: "REP", org: 25, reg: 35 },
    ],
    independent: 12,
    unregistered: 6,
    unaffiliatedOrg: 41,
  },
  competitiveD: {
    parties: [
      { abbr: "DEM", org: 31, reg: 43 },
      { abbr: "REP", org: 28, reg: 40 },
    ],
    independent: 12,
    unregistered: 7,
    unaffiliatedOrg: 41,
  },
  competitiveR: {
    parties: [
      { abbr: "DEM", org: 28, reg: 40 },
      { abbr: "REP", org: 31, reg: 43 },
    ],
    independent: 12,
    unregistered: 7,
    unaffiliatedOrg: 41,
  },
  leanR: {
    parties: [
      { abbr: "DEM", org: 25, reg: 35 },
      { abbr: "REP", org: 33, reg: 47 },
    ],
    independent: 12,
    unregistered: 6,
    unaffiliatedOrg: 41,
  },
  solidR: {
    parties: [
      { abbr: "DEM", org: 22, reg: 31 },
      { abbr: "REP", org: 36, reg: 52 },
    ],
    independent: 11,
    unregistered: 6,
    unaffiliatedOrg: 41,
  },
  strongR: {
    parties: [
      { abbr: "DEM", org: 19, reg: 26 },
      { abbr: "REP", org: 39, reg: 57 },
    ],
    independent: 11,
    unregistered: 6,
    unaffiliatedOrg: 41,
  },
} as const;

// Lane assignments — bucketed by 2000 presidential margin.
const US_ASSIGNMENTS_1999: Record<keyof typeof US_LANES_1999, string[]> = {
  strongD: ["RI", "MA", "NY", "HI", "MD", "CT", "NJ"],
  solidD: ["IL", "CA", "DE", "VT", "ME"],
  leanD: ["MI", "WA", "MN", "PA"],
  competitiveD: ["WI", "IA", "OR", "NM"],
  competitiveR: ["FL", "NH", "OH", "MO", "NV", "TN"],
  leanR: ["WV", "AR", "VA", "AZ", "CO", "LA"],
  solidR: ["GA", "NC", "SC", "IN", "KS", "KY", "MS"],
  strongR: ["AL", "AK", "ID", "MT", "NE", "ND", "SD", "OK", "UT", "WY", "TX"],
};

// Per-state overrides — registration-less / large-unaffiliated states, and the
// ancestral-Democrat South (DEM registration majority, Republican org/lean).
const US_OVERRIDES_1999: Record<string, Omit<StateRegistrationSeed, "countryId" | "stateId">> = {
  // DC: 2000 Gore 85% / Bush 9% — most Democratic jurisdiction.
  DC: {
    parties: [
      { abbr: "DEM", org: 45, reg: 80 },
      { abbr: "REP", org: 5, reg: 5 },
    ],
    independent: 7,
    unregistered: 8,
    unaffiliatedOrg: 50,
  },
  // AK: large undeclared/non-partisan bloc.
  AK: {
    parties: [
      { abbr: "DEM", org: 17, reg: 24 },
      { abbr: "REP", org: 27, reg: 35 },
    ],
    independent: 26,
    unregistered: 11,
    unaffiliatedOrg: 54,
  },
  // UT: strongR with a large unaffiliated pool.
  UT: {
    parties: [
      { abbr: "DEM", org: 16, reg: 22 },
      { abbr: "REP", org: 33, reg: 45 },
    ],
    independent: 22,
    unregistered: 11,
    unaffiliatedOrg: 53,
  },
  // TX: no party registration; Republican 1999 baseline.
  TX: {
    parties: [
      { abbr: "DEM", org: 28, reg: 38 },
      { abbr: "REP", org: 30, reg: 40 },
    ],
    independent: 13,
    unregistered: 8,
    unaffiliatedOrg: 41,
  },
  // WV: ~62% Democratic registration in 1999, narrowly went Bush in 2000.
  WV: {
    parties: [
      { abbr: "DEM", org: 28, reg: 60 },
      { abbr: "REP", org: 28, reg: 28 },
    ],
    independent: 7,
    unregistered: 6,
    unaffiliatedOrg: 41,
  },
  // KY: ~60% Democratic registration in 1999, ancestral D reg.
  KY: {
    parties: [
      { abbr: "DEM", org: 28, reg: 60 },
      { abbr: "REP", org: 30, reg: 33 },
    ],
    independent: 5,
    unregistered: 7,
    unaffiliatedOrg: 41,
  },
  // LA: closed-primary registration; ~56% Democratic in 1999.
  LA: {
    parties: [
      { abbr: "DEM", org: 27, reg: 56 },
      { abbr: "REP", org: 29, reg: 23 },
    ],
    independent: 12,
    unregistered: 8,
    unaffiliatedOrg: 41,
  },
  // OK: ~53% Democratic registration in 1999, ancestral D reg.
  OK: {
    parties: [
      { abbr: "DEM", org: 25, reg: 53 },
      { abbr: "REP", org: 31, reg: 36 },
    ],
    independent: 6,
    unregistered: 7,
    unaffiliatedOrg: 41,
  },
  // AR: no party registration; ancestral-D org, Republican-trending.
  AR: {
    parties: [
      { abbr: "DEM", org: 28, reg: 41 },
      { abbr: "REP", org: 28, reg: 35 },
    ],
    independent: 10,
    unregistered: 7,
    unaffiliatedOrg: 41,
  },
};

function buildUSSeeds1999(): StateRegistrationSeed[] {
  const seeds: StateRegistrationSeed[] = [];
  for (const [lane, states] of Object.entries(US_ASSIGNMENTS_1999) as Array<
    [keyof typeof US_LANES_1999, string[]]
  >) {
    const template = US_LANES_1999[lane];
    for (const stateId of states) {
      const override = US_OVERRIDES_1999[stateId];
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
  for (const [stateId, override] of Object.entries(US_OVERRIDES_1999)) {
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
 * Returns the US 1999-default registration / org seed bundle.
 * US-only: non-US countries in the 1999 preset fall back to their 2019 data.
 */
export function build1999RegistrationSeeds(): StateRegistrationSeed[] {
  return buildUSSeeds1999();
}
