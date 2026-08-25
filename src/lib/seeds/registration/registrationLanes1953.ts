/**
 * SEED INDEPENDENCE — DO NOT DERIVE FROM ANOTHER ERA.
 * Each era seed is self-contained. This file MUST NOT import and transform
 * another era's registration builders. All values are authored for 1953
 * directly. Type-only imports are allowed.
 */

/**
 * Party registration + organization seed for the four playable countries in
 * the 1953-default preset.
 *
 * DESIGN: 1953 is the ABSOLUTE PEAK of Solid South Democratic registration and
 * of the old New Deal coalition in its structural form. Eisenhower won a
 * PRESIDENTIAL landslide in 1952, but party REGISTRATION in the South barely
 * moved — most Southern whites were lifelong Democrats by registration even
 * while voting for Ike. The ancestral-Democrat South is even stronger than in
 * 1979.
 *
 * 1953-era characteristics vs 1979:
 *   - Independents LOWEST of all eras (~5-8 pts) — pre-dealignment; formal
 *     party identification extraordinarily strong; voters thought of themselves
 *     AS Democrats or Republicans, not independents
 *   - Unregistered HIGHER in South (pre-VRA 1965; poll taxes; literacy tests;
 *     Black disenfranchisement widespread; Southern unregistered pool large)
 *   - The Solid South at its structural peak: LA/MS/AL/SC had ~85-92%
 *     Democratic registration in 1953; AR/GA/TX/OK/WV/KY ~70-80% Dem
 *   - The Mountain West and Great Plains were the Republican stronghold
 *     (VT/ME/NH were still solid Republican; CT/NJ/NY were competitive)
 *   - Midwestern industrial states were competitive with slight Democratic
 *     lean (union households very Democratic)
 *   - New England outside VT/NH/ME was becoming more Democratic
 *     (Catholic working-class machine politics in MA/RI/CT)
 *
 * US values are curated from 1950s-era state SoS registration data and the
 * 1952 partisan map. UK values use the 1951 regional vote table, while RU and
 * DD make the explicitly-authored one-party / National Front organization
 * tables serve as the registration baseline. No country borrows another era.
 */

import type { StateRegistrationSeed } from "./registrationLanes";
import { HOUSE_SEATS_1953 } from "@/lib/constants/states";
import { UK_REGION_POLLING_1951 } from "@/lib/seeds/uk/ukRegionPolling1951";
import { RU_REGION_ORG_1953 } from "@/lib/seeds/ru/ruStatePartyOrgCalculations";
import { DD_REGION_ORG_1953 } from "@/lib/seeds/dd/ddStatePartyOrgCalculations";

const US_LANES_1953 = {
  strongD: {
    parties: [
      { abbr: "DEM", org: 42, reg: 65 },
      { abbr: "REP", org: 16, reg: 20 },
    ],
    independent: 7,
    unregistered: 8,
    unaffiliatedOrg: 42,
  },
  solidD: {
    parties: [
      { abbr: "DEM", org: 38, reg: 58 },
      { abbr: "REP", org: 20, reg: 29 },
    ],
    independent: 7,
    unregistered: 6,
    unaffiliatedOrg: 42,
  },
  leanD: {
    parties: [
      { abbr: "DEM", org: 34, reg: 50 },
      { abbr: "REP", org: 24, reg: 35 },
    ],
    independent: 8,
    unregistered: 7,
    unaffiliatedOrg: 42,
  },
  competitiveD: {
    parties: [
      { abbr: "DEM", org: 31, reg: 44 },
      { abbr: "REP", org: 28, reg: 42 },
    ],
    independent: 8,
    unregistered: 6,
    unaffiliatedOrg: 41,
  },
  competitiveR: {
    parties: [
      { abbr: "DEM", org: 28, reg: 42 },
      { abbr: "REP", org: 31, reg: 44 },
    ],
    independent: 8,
    unregistered: 6,
    unaffiliatedOrg: 41,
  },
  leanR: {
    parties: [
      { abbr: "DEM", org: 24, reg: 35 },
      { abbr: "REP", org: 34, reg: 50 },
    ],
    independent: 8,
    unregistered: 7,
    unaffiliatedOrg: 42,
  },
  solidR: {
    parties: [
      { abbr: "DEM", org: 20, reg: 29 },
      { abbr: "REP", org: 38, reg: 58 },
    ],
    independent: 7,
    unregistered: 6,
    unaffiliatedOrg: 42,
  },
  strongR: {
    parties: [
      { abbr: "DEM", org: 16, reg: 20 },
      { abbr: "REP", org: 42, reg: 65 },
    ],
    independent: 7,
    unregistered: 8,
    unaffiliatedOrg: 42,
  },
} as const;

// Lane assignments — bucketed by the 1953 partisan landscape (registration + org
// strength), NOT the 1952 presidential result. Democrats are structurally
// dominant in the South and border states; Republicans are strong in New England
// and the Plains.
const US_ASSIGNMENTS_1953: Record<keyof typeof US_LANES_1953, string[]> = {
  // 2026-08 balance retune: the previous table put the whole industrial North
  // in strongD/solidD, which gave Democrats an org/reg lead in 41 of 51
  // states. Outside the South, 1953 state party MACHINES were far more even:
  // the GOP ran strong state organizations across the North (Dewey's NY,
  // Ohio's Taft machine, Wisconsin/Indiana/Iowa GOP traditions), while the
  // Democratic machine strength was concentrated in Catholic-machine New
  // England, the DFL, the UAW/CIO belt, and big-city organizations. The
  // Solid South + border D wall lives entirely in US_OVERRIDES_1953 below.
  strongD: [],
  solidD: ["RI", "MA"],
  leanD: ["MN", "MI", "IL", "WA", "MD", "HI"],
  competitiveD: ["NY", "NJ", "PA", "MO", "DE", "NV", "FL"],
  competitiveR: ["OH", "CT", "CA", "OR", "MT", "NM", "AZ"],
  leanR: ["WI", "IN", "IA", "CO", "ID", "WY"],
  solidR: ["KS", "NE", "ND", "SD"],
  strongR: [],
};

// Per-state overrides — Solid South at its structural peak; highly skewed
// registration; large unregistered pools due to disenfranchisement; and
// states with unusual registration structures.
//
// Alaska and Hawaii remain authored here for statehood admission, but the
// bootstrap bundle filters them out while they are territories.
const US_OVERRIDES_1953: Record<string, Omit<StateRegistrationSeed, "countryId" | "stateId">> = {
  // DC: not yet enfranchised for presidential elections (23rd Amendment 1961).
  // Overwhelmingly Democratic; federal workers + Black community.
  DC: {
    parties: [
      { abbr: "DEM", org: 40, reg: 65 },
      { abbr: "REP", org: 8, reg: 12 },
    ],
    independent: 5,
    unregistered: 18,
    unaffiliatedOrg: 52,
  },
  // MS: most disenfranchised state; ~87% of registered voters are Dem.
  // Large unregistered pool from Black disenfranchisement.
  MS: {
    parties: [
      { abbr: "DEM", org: 38, reg: 66 },
      { abbr: "REP", org: 8, reg: 6 },
    ],
    independent: 3,
    unregistered: 25,
    unaffiliatedOrg: 54,
  },
  // AL: similar to MS; very high Dem registration; large disenfranchised pool.
  AL: {
    parties: [
      { abbr: "DEM", org: 36, reg: 67 },
      { abbr: "REP", org: 10, reg: 8 },
    ],
    independent: 3,
    unregistered: 22,
    unaffiliatedOrg: 54,
  },
  // SC: ~82% Democratic registration; large Black disenfranchised pool.
  SC: {
    parties: [
      { abbr: "DEM", org: 35, reg: 67 },
      { abbr: "REP", org: 10, reg: 8 },
    ],
    independent: 3,
    unregistered: 22,
    unaffiliatedOrg: 55,
  },
  // GA: ~78% Democratic registration; poll tax; Jim Crow.
  GA: {
    parties: [
      { abbr: "DEM", org: 34, reg: 66 },
      { abbr: "REP", org: 12, reg: 10 },
    ],
    independent: 4,
    unregistered: 20,
    unaffiliatedOrg: 54,
  },
  // LA: closed-primary registration; ~80% Democratic in 1953.
  LA: {
    parties: [
      { abbr: "DEM", org: 35, reg: 71 },
      { abbr: "REP", org: 12, reg: 9 },
    ],
    independent: 4,
    unregistered: 16,
    unaffiliatedOrg: 53,
  },
  // AR: open primary; ~80% Democratic registration; one-party state.
  AR: {
    parties: [
      { abbr: "DEM", org: 36, reg: 71 },
      { abbr: "REP", org: 10, reg: 9 },
    ],
    independent: 4,
    unregistered: 16,
    unaffiliatedOrg: 54,
  },
  // NC: ~72% Democratic registration; significant Black disenfranchisement.
  NC: {
    parties: [
      { abbr: "DEM", org: 34, reg: 63 },
      { abbr: "REP", org: 18, reg: 18 },
    ],
    independent: 4,
    unregistered: 15,
    unaffiliatedOrg: 48,
  },
  // TN: ~68% Democratic registration; three-party county variation.
  TN: {
    parties: [
      { abbr: "DEM", org: 32, reg: 61 },
      { abbr: "REP", org: 20, reg: 23 },
    ],
    independent: 4,
    unregistered: 12,
    unaffiliatedOrg: 48,
  },
  // VA: ~68% Democratic registration; poll tax; Byrd machine.
  VA: {
    parties: [
      { abbr: "DEM", org: 32, reg: 60 },
      { abbr: "REP", org: 18, reg: 20 },
    ],
    independent: 4,
    unregistered: 16,
    unaffiliatedOrg: 50,
  },
  // KY: ~72% Democratic registration in 1953; ancestral border-state Dem.
  KY: {
    parties: [
      { abbr: "DEM", org: 34, reg: 68 },
      { abbr: "REP", org: 20, reg: 23 },
    ],
    independent: 3,
    unregistered: 6,
    unaffiliatedOrg: 46,
  },
  // WV: ~74% Democratic registration in 1953; coal miners strongly union-Dem.
  WV: {
    parties: [
      { abbr: "DEM", org: 35, reg: 71 },
      { abbr: "REP", org: 18, reg: 21 },
    ],
    independent: 3,
    unregistered: 5,
    unaffiliatedOrg: 47,
  },
  // OK: ~75% Democratic registration; ancestral-D; no party primary confusion.
  OK: {
    parties: [
      { abbr: "DEM", org: 32, reg: 71 },
      { abbr: "REP", org: 18, reg: 19 },
    ],
    independent: 3,
    unregistered: 7,
    unaffiliatedOrg: 50,
  },
  // TX: no party registration; open primary; 70%+ historical Dem voting.
  TX: {
    parties: [
      { abbr: "DEM", org: 35, reg: 63 },
      { abbr: "REP", org: 18, reg: 20 },
    ],
    independent: 5,
    unregistered: 12,
    unaffiliatedOrg: 47,
  },
  // VT: the most Republican state; strong Republican machine; very solidR.
  VT: {
    parties: [
      { abbr: "DEM", org: 12, reg: 22 },
      { abbr: "REP", org: 42, reg: 68 },
    ],
    independent: 6,
    unregistered: 4,
    unaffiliatedOrg: 46,
  },
  // ME: historically Republican but shifting; less extreme than VT.
  ME: {
    parties: [
      { abbr: "DEM", org: 18, reg: 28 },
      { abbr: "REP", org: 36, reg: 55 },
    ],
    independent: 8,
    unregistered: 9,
    unaffiliatedOrg: 46,
  },
  // NH: strong Republican state; granite-hard GOP tradition.
  NH: {
    parties: [
      { abbr: "DEM", org: 20, reg: 30 },
      { abbr: "REP", org: 34, reg: 54 },
    ],
    independent: 9,
    unregistered: 7,
    unaffiliatedOrg: 46,
  },
  // UT: strongly Republican; LDS community; Eisenhower country.
  UT: {
    parties: [
      { abbr: "DEM", org: 16, reg: 22 },
      { abbr: "REP", org: 40, reg: 62 },
    ],
    independent: 9,
    unregistered: 7,
    unaffiliatedOrg: 44,
  },
  // AK: territory with strong non-partisan tradition; large undeclared bloc.
  AK: {
    parties: [
      { abbr: "DEM", org: 22, reg: 32 },
      { abbr: "REP", org: 22, reg: 30 },
    ],
    independent: 24,
    unregistered: 14,
    unaffiliatedOrg: 56,
  },
};

function buildAllUSSeeds1953(): StateRegistrationSeed[] {
  const seeds: StateRegistrationSeed[] = [];
  for (const [lane, states] of Object.entries(US_ASSIGNMENTS_1953) as Array<
    [keyof typeof US_LANES_1953, string[]]
  >) {
    const template = US_LANES_1953[lane];
    for (const stateId of states) {
      const override = US_OVERRIDES_1953[stateId];
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
  for (const [stateId, override] of Object.entries(US_OVERRIDES_1953)) {
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

function buildUSSeeds1953(): StateRegistrationSeed[] {
  return buildAllUSSeeds1953().filter((seed) => seed.stateId in HOUSE_SEATS_1953);
}

/**
 * Return a 1953 US row even when the jurisdiction was still a territory.
 * Statehood admission uses this to create Alaska/Hawaii political state only
 * after admission; the bootstrap bundle itself remains the constitutional 48.
 */
export function get1953USRegistrationSeed(stateId: string): StateRegistrationSeed | null {
  return buildAllUSSeeds1953().find((seed) => seed.stateId === stateId) ?? null;
}

const UK_SLUG_TO_ABBR: Record<string, string> = {
  uk_labour: "LAB",
  uk_conservative: "CON",
  uk_liberal: "LIB",
  uk_snp: "SNP",
  uk_plaid: "PC",
  uk_sf: "SF",
};

function buildUKSeeds1953(): StateRegistrationSeed[] {
  return Object.entries(UK_REGION_POLLING_1951).map(([stateId, votes]) => {
    const parties = Object.entries(votes)
      .filter(([slug]) => UK_SLUG_TO_ABBR[slug] != null)
      .map(([slug, voteShare]) => ({
        abbr: UK_SLUG_TO_ABBR[slug],
        // Organization is a strength share, not raw polling. A 60% scale
        // leaves a historically large unaffiliated organizing pool while a
        // floor preserves the tiny home-region parties seeded by the UK org
        // table at zero vote share.
        org: Math.max(3, Math.round(voteShare * 0.6)),
        reg: voteShare,
      }));
    const partyReg = parties.reduce((sum, party) => sum + party.reg, 0);
    const partyOrg = parties.reduce((sum, party) => sum + party.org, 0);
    return {
      countryId: "UK",
      stateId,
      parties,
      independent: 100 - partyReg,
      unregistered: 0,
      unaffiliatedOrg: 100 - partyOrg,
    };
  });
}

function buildRUSeeds1953(): StateRegistrationSeed[] {
  return Object.entries(RU_REGION_ORG_1953).map(([stateId, { cpsu }]) => ({
    countryId: "RU",
    stateId,
    parties: [{ abbr: "CPSU", org: cpsu, reg: cpsu }],
    independent: 100 - cpsu,
    unregistered: 0,
    unaffiliatedOrg: 100 - cpsu,
  }));
}

function buildDDSeeds1953(): StateRegistrationSeed[] {
  return Object.entries(DD_REGION_ORG_1953).map(([stateId, org]) => {
    const parties = [
      { abbr: "SED", value: org.sed },
      { abbr: "CDU", value: org.cdu },
      { abbr: "LDPD", value: org.ldpd },
      { abbr: "NDPD", value: org.ndpd },
      { abbr: "DBD", value: org.dbd },
    ].map(({ abbr, value }) => ({ abbr, org: value, reg: value }));
    const represented = parties.reduce((sum, party) => sum + party.reg, 0);
    return {
      countryId: "DD",
      stateId,
      parties,
      independent: 100 - represented,
      unregistered: 0,
      unaffiliatedOrg: 100 - represented,
    };
  });
}

/**
 * Returns the complete 1953-default registration / org seed bundle for the
 * four playable countries.
 */
export function build1953RegistrationSeeds(): StateRegistrationSeed[] {
  return [
    ...buildUSSeeds1953(),
    ...buildUKSeeds1953(),
    ...buildRUSeeds1953(),
    ...buildDDSeeds1953(),
  ];
}
