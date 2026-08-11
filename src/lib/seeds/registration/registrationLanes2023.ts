/**
 * SEED INDEPENDENCE — DO NOT DERIVE FROM ANOTHER ERA.
 * Each era seed is self-contained. This file MUST NOT import and transform
 * another era's seed data (e.g. the 2019/1991 registration builders). All values
 * are authored for 2023 directly. Changing another era's seed must never alter
 * 2023. Type-only imports are allowed.
 */

/**
 * US party registration + organization seed for the 2023-default preset.
 *
 * Anchored to 2022 state voter-registration data + 2022 midterm election
 * results. Key documented 2023-era shifts from 2019:
 *
 *   - Independent/unaffiliated registration growth: independents up +1 to +2 pts
 *     in most states, reflecting continued decline of formal party registration.
 *   - Florida registration flip: by Nov 2022, Republicans held a ~600k-voter
 *     registration lead in FL. DEM reg falls to ~29%, REP rises to ~40%.
 *   - Nevada: Dems retain slight registration lead but narrowed (no-party
 *     registrants now the single largest bloc).
 *   - AZ: Republicans narrowly trail Dems in reg by 2023; independents large.
 *   - TX: remains no-registration state; org/lean reflects 2022 outcome.
 *   - GA: competitive with slight R org edge reflecting continued R gains.
 *   - Strong-R states: Republican org/reg up slightly as realignment continued.
 *   - VA/CO: solidified Dem lean; lean categories nudged toward solidD.
 *   - National unregistered: slight uptick (+1) in several Southern states.
 *
 * US-only: non-US countries fall back to their 2019 lanes on a 2023 reset.
 *
 * Curated from NCSL/state SoS 2022 registration data and 2022 election results.
 */

import type { StateRegistrationSeed } from "./registrationLanes";

// ─── 2023 US lane templates ──────────────────────────────────────────────────
// Independents up ~1pt vs 2019 across all lanes; party orgs/regs adjusted
// to reflect 2022 registration trends.

const US_LANES_2023 = {
  strongD: {
    parties: [
      { abbr: "DEM", org: 36, reg: 49 },
      { abbr: "REP", org: 21, reg: 25 },
    ],
    independent: 17,
    unregistered: 9,
    unaffiliatedOrg: 43,
  },
  solidD: {
    parties: [
      { abbr: "DEM", org: 34, reg: 45 },
      { abbr: "REP", org: 23, reg: 30 },
    ],
    independent: 17,
    unregistered: 8,
    unaffiliatedOrg: 43,
  },
  leanD: {
    parties: [
      { abbr: "DEM", org: 31, reg: 41 },
      { abbr: "REP", org: 26, reg: 33 },
    ],
    independent: 18,
    unregistered: 8,
    unaffiliatedOrg: 43,
  },
  competitiveD: {
    parties: [
      { abbr: "DEM", org: 29, reg: 37 },
      { abbr: "REP", org: 28, reg: 36 },
    ],
    independent: 19,
    unregistered: 8,
    unaffiliatedOrg: 43,
  },
  competitiveR: {
    parties: [
      { abbr: "DEM", org: 27, reg: 35 },
      { abbr: "REP", org: 29, reg: 37 },
    ],
    independent: 19,
    unregistered: 9,
    unaffiliatedOrg: 44,
  },
  leanR: {
    parties: [
      { abbr: "DEM", org: 26, reg: 33 },
      { abbr: "REP", org: 31, reg: 40 },
    ],
    independent: 18,
    unregistered: 9,
    unaffiliatedOrg: 43,
  },
  solidR: {
    parties: [
      { abbr: "DEM", org: 23, reg: 30 },
      { abbr: "REP", org: 34, reg: 44 },
    ],
    independent: 17,
    unregistered: 9,
    unaffiliatedOrg: 43,
  },
  strongR: {
    parties: [
      { abbr: "DEM", org: 21, reg: 26 },
      { abbr: "REP", org: 37, reg: 50 },
    ],
    independent: 16,
    unregistered: 8,
    unaffiliatedOrg: 42,
  },
} as const;

// Lane assignments — same state groupings as 2019 but reflecting 2022
// registration trends. VA and CO shifted toward solidD per continued
// Dem dominance in those states.
const US_ASSIGNMENTS_2023: Record<keyof typeof US_LANES_2023, string[]> = {
  strongD: ["CA", "HI", "MD", "MA", "NY", "VT"],
  solidD: ["CO", "CT", "DE", "IL", "NJ", "RI", "VA", "WA"],
  leanD: ["ME", "MN", "NM", "NH", "OR"],
  competitiveD: ["MI", "NV", "PA", "WI"],
  competitiveR: ["NC"],
  leanR: ["IA", "OH"],
  solidR: ["IN", "KS", "MO", "NE", "SC"],
  strongR: ["AL", "AR", "ID", "KY", "LA", "MS", "ND", "OK", "SD", "TN", "WV", "WY"],
};

// Per-state overrides for jurisdictions with notable 2023-era registration
// characteristics that diverge from their lane template.
const US_OVERRIDES_2023: Record<string, Omit<StateRegistrationSeed, "countryId" | "stateId">> = {
  // DC: 2020 Biden 92.2% / Trump 5.4%; remains the most Democratic jurisdiction.
  DC: {
    parties: [
      { abbr: "DEM", org: 43, reg: 76 },
      { abbr: "REP", org: 7, reg: 7 },
    ],
    independent: 9,
    unregistered: 8,
    unaffiliatedOrg: 50,
  },
  // AK: Large unaffiliated bloc; independents the biggest registration group.
  AK: {
    parties: [
      { abbr: "DEM", org: 19, reg: 27 },
      { abbr: "REP", org: 28, reg: 37 },
    ],
    independent: 25,
    unregistered: 11,
    unaffiliatedOrg: 53,
  },
  // UT: Large unaffiliated pool; strong LDS community drives independent lean.
  UT: {
    parties: [
      { abbr: "DEM", org: 15, reg: 20 },
      { abbr: "REP", org: 32, reg: 43 },
    ],
    independent: 26,
    unregistered: 11,
    unaffiliatedOrg: 53,
  },
  // FL: By 2022 Republicans held ~600k registration lead; now leanR territory.
  FL: {
    parties: [
      { abbr: "DEM", org: 26, reg: 29 },
      { abbr: "REP", org: 31, reg: 40 },
    ],
    independent: 22,
    unregistered: 9,
    unaffiliatedOrg: 43,
  },
  // TX: No-party-registration state; org/lean reflects 2022 R gains.
  TX: {
    parties: [
      { abbr: "DEM", org: 26, reg: 34 },
      { abbr: "REP", org: 32, reg: 42 },
    ],
    independent: 16,
    unregistered: 8,
    unaffiliatedOrg: 42,
  },
  // GA: Competitive; Republicans retain slight org edge after 2022 results.
  GA: {
    parties: [
      { abbr: "DEM", org: 29, reg: 38 },
      { abbr: "REP", org: 29, reg: 37 },
    ],
    independent: 17,
    unregistered: 8,
    unaffiliatedOrg: 42,
  },
  // AZ: Independents are now the largest registration bloc; Dems and Rs close.
  AZ: {
    parties: [
      { abbr: "DEM", org: 28, reg: 35 },
      { abbr: "REP", org: 28, reg: 35 },
    ],
    independent: 22,
    unregistered: 8,
    unaffiliatedOrg: 44,
  },
  // MT: Remains solidR; R gains in 2022 continued.
  MT: {
    parties: [
      { abbr: "DEM", org: 22, reg: 29 },
      { abbr: "REP", org: 35, reg: 45 },
    ],
    independent: 17,
    unregistered: 9,
    unaffiliatedOrg: 43,
  },
};

function buildUSSeeds2023(): StateRegistrationSeed[] {
  const seeds: StateRegistrationSeed[] = [];

  for (const [lane, states] of Object.entries(US_ASSIGNMENTS_2023) as Array<
    [keyof typeof US_LANES_2023, string[]]
  >) {
    const template = US_LANES_2023[lane];
    for (const stateId of states) {
      const override = US_OVERRIDES_2023[stateId];
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
  for (const [stateId, override] of Object.entries(US_OVERRIDES_2023)) {
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
 * Returns the US 2023-default registration / org seed bundle.
 * US-only: non-US countries in the 2023 preset fall back to their 2019 data.
 */
export function build2023RegistrationSeeds(): StateRegistrationSeed[] {
  return buildUSSeeds2023();
}
