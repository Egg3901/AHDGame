/**
 * Curated Registration / Org bootstrap seed values per the plan's
 * Bootstrap Seed appendix (Pass 1 lane templates + Pass 2 curated
 * assignments). Source of truth:
 *
 *   docs/plans/archive/2026-05/2026-05-03-political-system-rework.md
 *     §"Bootstrap Seed Curation - Pass 1 / Pass 2"
 *
 * Per design doc §4.4, every per-state row must satisfy:
 *
 *   Σ partyReg + independent + unregistered = 100
 *   Σ partyOrg + unaffiliatedOrg            = 100
 *
 * The migration validates these invariants before writing.
 *
 * Party identifiers are the `politicalParties.abbreviation` (the values
 * the seed files actually use, e.g. "DEM"/"REP"/"CON"/"LAB"/"LDP"). The
 * migration translates abbreviations to `sequentialId` strings before
 * writing to `StatePartyOrg`.
 */

export interface SeedShare {
  /** Party abbreviation (matches `PoliticalParty.abbreviation`). */
  abbr: string;
  /** Org%, 0..100. */
  org: number;
  /** Reg%, 0..100. */
  reg: number;
}

export interface StateRegistrationSeed {
  countryId: "US" | "UK" | "JP" | "DE" | "BR" | "IE" | "CN" | "RU" | "DD";
  stateId: string;
  parties: SeedShare[];
  independent: number;
  unregistered: number;
  /** 100 − Σ org. Stored for documentation / cross-check; derived. */
  unaffiliatedOrg: number;
}

// ─── US lane templates (Pass 1) ──────────────────────────────────────────────

const US_LANES = {
  strongD: {
    parties: [
      { abbr: "DEM", org: 36, reg: 49 },
      { abbr: "REP", org: 22, reg: 27 },
    ],
    independent: 16,
    unregistered: 8,
    unaffiliatedOrg: 42,
  },
  solidD: {
    parties: [
      { abbr: "DEM", org: 34, reg: 45 },
      { abbr: "REP", org: 24, reg: 31 },
    ],
    independent: 16,
    unregistered: 8,
    unaffiliatedOrg: 42,
  },
  leanD: {
    parties: [
      { abbr: "DEM", org: 31, reg: 41 },
      { abbr: "REP", org: 27, reg: 34 },
    ],
    independent: 17,
    unregistered: 8,
    unaffiliatedOrg: 42,
  },
  competitiveD: {
    parties: [
      { abbr: "DEM", org: 29, reg: 38 },
      { abbr: "REP", org: 28, reg: 36 },
    ],
    independent: 18,
    unregistered: 8,
    unaffiliatedOrg: 43,
  },
  competitiveR: {
    parties: [
      { abbr: "DEM", org: 28, reg: 36 },
      { abbr: "REP", org: 29, reg: 38 },
    ],
    independent: 18,
    unregistered: 8,
    unaffiliatedOrg: 43,
  },
  leanR: {
    parties: [
      { abbr: "DEM", org: 27, reg: 34 },
      { abbr: "REP", org: 31, reg: 41 },
    ],
    independent: 17,
    unregistered: 8,
    unaffiliatedOrg: 42,
  },
  solidR: {
    parties: [
      { abbr: "DEM", org: 24, reg: 31 },
      { abbr: "REP", org: 34, reg: 45 },
    ],
    independent: 16,
    unregistered: 8,
    unaffiliatedOrg: 42,
  },
  strongR: {
    parties: [
      { abbr: "DEM", org: 22, reg: 27 },
      { abbr: "REP", org: 36, reg: 49 },
    ],
    independent: 16,
    unregistered: 8,
    unaffiliatedOrg: 42,
  },
} as const;

const US_ASSIGNMENTS: Record<keyof typeof US_LANES, string[]> = {
  strongD: ["CA", "HI", "MD", "MA", "NY", "VT"],
  solidD: ["CT", "DE", "IL", "NJ", "RI", "WA"],
  leanD: ["CO", "ME", "MN", "NM", "OR", "VA", "NH"],
  competitiveD: ["MI", "NV", "PA", "WI"],
  competitiveR: ["FL", "NC"],
  leanR: ["IA", "OH"],
  solidR: ["IN", "KS", "MO", "NE", "SC"],
  strongR: ["AL", "AR", "ID", "KY", "LA", "MS", "ND", "OK", "SD", "TN", "WV", "WY"],
};

// US per-state overrides (from plan §"US custom overrides worth preserving").
// DC is added as a strongD override: 2020 Biden 92.2% / Trump 5.4%, so it's
// the most Democratic jurisdiction in the country. It has no House districts
// or state senate seats; the registration lane exists for presidential math.
const US_OVERRIDES: Record<string, Omit<StateRegistrationSeed, "countryId" | "stateId">> = {
  DC: {
    parties: [
      { abbr: "DEM", org: 42, reg: 75 },
      { abbr: "REP", org: 8, reg: 8 },
    ],
    independent: 9,
    unregistered: 8,
    unaffiliatedOrg: 50,
  },
  AK: {
    parties: [
      { abbr: "DEM", org: 20, reg: 29 },
      { abbr: "REP", org: 28, reg: 38 },
    ],
    independent: 23,
    unregistered: 10,
    unaffiliatedOrg: 52,
  },
  UT: {
    parties: [
      { abbr: "DEM", org: 16, reg: 22 },
      { abbr: "REP", org: 32, reg: 44 },
    ],
    independent: 24,
    unregistered: 10,
    unaffiliatedOrg: 52,
  },
  FL: {
    parties: [
      { abbr: "DEM", org: 28, reg: 35 },
      { abbr: "REP", org: 29, reg: 39 },
    ],
    independent: 18,
    unregistered: 8,
    unaffiliatedOrg: 43,
  },
  TX: {
    parties: [
      { abbr: "DEM", org: 27, reg: 35 },
      { abbr: "REP", org: 31, reg: 41 },
    ],
    independent: 16,
    unregistered: 8,
    unaffiliatedOrg: 42,
  },
  GA: {
    parties: [
      { abbr: "DEM", org: 29, reg: 38 },
      { abbr: "REP", org: 29, reg: 37 },
    ],
    independent: 17,
    unregistered: 8,
    unaffiliatedOrg: 42,
  },
  AZ: {
    parties: [
      { abbr: "DEM", org: 29, reg: 38 },
      { abbr: "REP", org: 28, reg: 36 },
    ],
    independent: 18,
    unregistered: 8,
    unaffiliatedOrg: 43,
  },
  // MT — not in any lane bucket above; plan keeps it Solid R per the
  // "Solid R: AK, IN, KS, MO, MT, NE, SC, UT" original list. We'd already
  // applied AK/UT overrides; MT keeps the Solid R lane.
  MT: {
    parties: US_LANES.solidR.parties.map((p) => ({ ...p })),
    independent: US_LANES.solidR.independent,
    unregistered: US_LANES.solidR.unregistered,
    unaffiliatedOrg: US_LANES.solidR.unaffiliatedOrg,
  },
};

function buildUSSeeds(): StateRegistrationSeed[] {
  const seeds: StateRegistrationSeed[] = [];
  for (const [lane, states] of Object.entries(US_ASSIGNMENTS) as Array<
    [keyof typeof US_LANES, string[]]
  >) {
    const template = US_LANES[lane];
    for (const stateId of states) {
      const override = US_OVERRIDES[stateId];
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
  for (const [stateId, override] of Object.entries(US_OVERRIDES)) {
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

// ─── UK direct curation (Pass 2) ─────────────────────────────────────────────

const UK_SEEDS: Array<Omit<StateRegistrationSeed, "countryId">> = [
  {
    stateId: "LON",
    parties: [
      { abbr: "LAB", org: 30, reg: 38 },
      { abbr: "CON", org: 15, reg: 20 },
      { abbr: "LD", org: 10, reg: 13 },
      { abbr: "GRN", org: 8, reg: 7 },
    ],
    independent: 14,
    unregistered: 8,
    unaffiliatedOrg: 37,
  },
  {
    stateId: "SEE",
    parties: [
      { abbr: "CON", org: 31, reg: 39 },
      { abbr: "LAB", org: 17, reg: 22 },
      { abbr: "LD", org: 10, reg: 14 },
      { abbr: "RUK", org: 4, reg: 5 },
      { abbr: "GRN", org: 3, reg: 4 },
    ],
    independent: 10,
    unregistered: 6,
    unaffiliatedOrg: 35,
  },
  {
    stateId: "SWE",
    parties: [
      { abbr: "CON", org: 28, reg: 34 },
      { abbr: "LD", org: 14, reg: 18 },
      { abbr: "LAB", org: 13, reg: 18 },
      { abbr: "GRN", org: 5, reg: 6 },
      { abbr: "RUK", org: 4, reg: 5 },
    ],
    independent: 11,
    unregistered: 8,
    unaffiliatedOrg: 36,
  },
  {
    stateId: "EAE",
    parties: [
      { abbr: "CON", org: 31, reg: 40 },
      { abbr: "LAB", org: 16, reg: 21 },
      { abbr: "LD", org: 9, reg: 12 },
      { abbr: "RUK", org: 4, reg: 5 },
      { abbr: "GRN", org: 3, reg: 3 },
    ],
    independent: 11,
    unregistered: 8,
    unaffiliatedOrg: 37,
  },
  {
    stateId: "EMI",
    parties: [
      { abbr: "CON", org: 29, reg: 37 },
      { abbr: "LAB", org: 20, reg: 26 },
      { abbr: "LD", org: 6, reg: 7 },
      { abbr: "RUK", org: 5, reg: 6 },
      { abbr: "GRN", org: 2, reg: 3 },
    ],
    independent: 12,
    unregistered: 9,
    unaffiliatedOrg: 38,
  },
  {
    stateId: "WMI",
    parties: [
      { abbr: "CON", org: 27, reg: 34 },
      { abbr: "LAB", org: 24, reg: 31 },
      { abbr: "LD", org: 6, reg: 8 },
      { abbr: "RUK", org: 4, reg: 5 },
      { abbr: "GRN", org: 2, reg: 3 },
    ],
    independent: 11,
    unregistered: 8,
    unaffiliatedOrg: 37,
  },
  {
    stateId: "YHU",
    parties: [
      { abbr: "LAB", org: 25, reg: 31 },
      { abbr: "CON", org: 25, reg: 31 },
      { abbr: "LD", org: 5, reg: 6 },
      { abbr: "RUK", org: 5, reg: 7 },
      { abbr: "GRN", org: 2, reg: 3 },
    ],
    independent: 13,
    unregistered: 9,
    unaffiliatedOrg: 38,
  },
  {
    stateId: "NWE",
    parties: [
      { abbr: "LAB", org: 28, reg: 36 },
      { abbr: "CON", org: 20, reg: 25 },
      { abbr: "LD", org: 7, reg: 8 },
      { abbr: "RUK", org: 4, reg: 5 },
      { abbr: "GRN", org: 3, reg: 4 },
    ],
    independent: 13,
    unregistered: 9,
    unaffiliatedOrg: 38,
  },
  {
    stateId: "NEE",
    parties: [
      { abbr: "LAB", org: 24, reg: 30 },
      { abbr: "CON", org: 24, reg: 30 },
      { abbr: "RUK", org: 6, reg: 8 },
      { abbr: "LD", org: 4, reg: 5 },
      { abbr: "GRN", org: 2, reg: 3 },
    ],
    independent: 14,
    unregistered: 10,
    unaffiliatedOrg: 40,
  },
  {
    stateId: "SCO",
    parties: [
      { abbr: "SNP", org: 30, reg: 40 },
      { abbr: "LAB", org: 16, reg: 20 },
      { abbr: "CON", org: 10, reg: 12 },
      { abbr: "LD", org: 5, reg: 7 },
      { abbr: "GRN", org: 4, reg: 4 },
    ],
    independent: 11,
    unregistered: 6,
    unaffiliatedOrg: 35,
  },
  {
    stateId: "WAL",
    parties: [
      { abbr: "LAB", org: 24, reg: 31 },
      { abbr: "CON", org: 16, reg: 21 },
      { abbr: "PC", org: 14, reg: 18 },
      { abbr: "LD", org: 4, reg: 5 },
      { abbr: "GRN", org: 3, reg: 4 },
    ],
    independent: 13,
    unregistered: 8,
    unaffiliatedOrg: 39,
  },
  {
    stateId: "NIR",
    parties: [
      { abbr: "DUP", org: 18, reg: 22 },
      { abbr: "SF", org: 18, reg: 21 },
    ],
    independent: 39,
    unregistered: 18,
    unaffiliatedOrg: 64,
  },
];

// ─── JP direct curation (Pass 2) ─────────────────────────────────────────────

const JP_SEEDS: Array<Omit<StateRegistrationSeed, "countryId">> = [
  {
    stateId: "HOK",
    parties: [
      { abbr: "LDP", org: 24, reg: 32 },
      { abbr: "CDP", org: 20, reg: 26 },
      { abbr: "KMT", org: 8, reg: 9 },
      { abbr: "JCP", org: 5, reg: 8 },
      { abbr: "DPFP", org: 4, reg: 5 },
    ],
    independent: 12,
    unregistered: 8,
    unaffiliatedOrg: 39,
  },
  {
    stateId: "TOH",
    parties: [
      { abbr: "LDP", org: 27, reg: 37 },
      { abbr: "CDP", org: 16, reg: 23 },
      { abbr: "KMT", org: 8, reg: 9 },
      { abbr: "JCP", org: 4, reg: 6 },
      { abbr: "DPFP", org: 3, reg: 4 },
    ],
    independent: 13,
    unregistered: 8,
    unaffiliatedOrg: 42,
  },
  {
    stateId: "KAN",
    parties: [
      { abbr: "LDP", org: 24, reg: 31 },
      { abbr: "CDP", org: 17, reg: 22 },
      { abbr: "KMT", org: 10, reg: 12 },
      { abbr: "JCP", org: 6, reg: 9 },
      { abbr: "DPFP", org: 5, reg: 5 },
      { abbr: "ISH", org: 4, reg: 6 },
    ],
    independent: 9,
    unregistered: 6,
    unaffiliatedOrg: 34,
  },
  {
    stateId: "CHU",
    parties: [
      { abbr: "LDP", org: 28, reg: 38 },
      { abbr: "CDP", org: 13, reg: 18 },
      { abbr: "KMT", org: 8, reg: 10 },
      { abbr: "ISH", org: 6, reg: 9 },
      { abbr: "DPFP", org: 4, reg: 5 },
      { abbr: "JCP", org: 3, reg: 5 },
    ],
    independent: 9,
    unregistered: 6,
    unaffiliatedOrg: 38,
  },
  {
    stateId: "KNS",
    parties: [
      { abbr: "LDP", org: 22, reg: 24 },
      { abbr: "ISH", org: 20, reg: 28 },
      { abbr: "KMT", org: 12, reg: 11 },
      { abbr: "CDP", org: 8, reg: 11 },
      { abbr: "JCP", org: 4, reg: 7 },
      { abbr: "DPFP", org: 3, reg: 4 },
    ],
    independent: 9,
    unregistered: 6,
    unaffiliatedOrg: 31,
  },
  {
    stateId: "CGK",
    parties: [
      { abbr: "LDP", org: 30, reg: 41 },
      { abbr: "KMT", org: 9, reg: 11 },
      { abbr: "CDP", org: 10, reg: 15 },
      { abbr: "ISH", org: 4, reg: 6 },
      { abbr: "JCP", org: 3, reg: 5 },
      { abbr: "DPFP", org: 0, reg: 3 },
    ],
    independent: 11,
    unregistered: 8,
    unaffiliatedOrg: 44,
  },
  {
    stateId: "SHI",
    parties: [
      { abbr: "LDP", org: 29, reg: 40 },
      { abbr: "KMT", org: 10, reg: 12 },
      { abbr: "ISH", org: 5, reg: 8 },
      { abbr: "CDP", org: 8, reg: 13 },
      { abbr: "JCP", org: 3, reg: 5 },
      { abbr: "DPFP", org: 0, reg: 3 },
    ],
    independent: 11,
    unregistered: 8,
    unaffiliatedOrg: 45,
  },
  {
    stateId: "KYU",
    parties: [
      { abbr: "LDP", org: 26, reg: 33 },
      { abbr: "KMT", org: 11, reg: 14 },
      { abbr: "CDP", org: 11, reg: 18 },
      { abbr: "JCP", org: 4, reg: 6 },
      { abbr: "DPFP", org: 4, reg: 4 },
      { abbr: "ISH", org: 3, reg: 4 },
    ],
    independent: 13,
    unregistered: 8,
    unaffiliatedOrg: 41,
  },
];

// ─── DE direct curation (Pass 2) ─────────────────────────────────────────────

const DE_SEEDS: Array<Omit<StateRegistrationSeed, "countryId">> = [
  {
    stateId: "BW",
    parties: [
      { abbr: "CDU", org: 22, reg: 28 },
      { abbr: "SPD", org: 16, reg: 22 },
      { abbr: "GRN", org: 16, reg: 19 },
      { abbr: "FDP", org: 9, reg: 10 },
      { abbr: "AFD", org: 5, reg: 8 },
    ],
    independent: 8,
    unregistered: 5,
    unaffiliatedOrg: 32,
  },
  {
    stateId: "BY",
    parties: [
      { abbr: "CSU", org: 28, reg: 36 },
      { abbr: "SPD", org: 12, reg: 18 },
      { abbr: "GRN", org: 14, reg: 16 },
      { abbr: "FDP", org: 7, reg: 9 },
      { abbr: "AFD", org: 4, reg: 7 },
    ],
    independent: 9,
    unregistered: 5,
    unaffiliatedOrg: 35,
  },
  {
    stateId: "BE",
    parties: [
      { abbr: "SPD", org: 16, reg: 22 },
      { abbr: "GRN", org: 16, reg: 22 },
      { abbr: "CDU", org: 12, reg: 17 },
      { abbr: "LNK", org: 11, reg: 12 },
      { abbr: "AFD", org: 4, reg: 8 },
      { abbr: "FDP", org: 4, reg: 6 },
    ],
    independent: 8,
    unregistered: 5,
    unaffiliatedOrg: 37,
  },
  {
    stateId: "BB",
    parties: [
      { abbr: "SPD", org: 20, reg: 30 },
      { abbr: "AFD", org: 12, reg: 18 },
      { abbr: "CDU", org: 8, reg: 15 },
      { abbr: "LNK", org: 8, reg: 9 },
      { abbr: "GRN", org: 4, reg: 8 },
      { abbr: "FDP", org: 4, reg: 5 },
    ],
    independent: 9,
    unregistered: 6,
    unaffiliatedOrg: 44,
  },
  {
    stateId: "BRE",
    parties: [
      { abbr: "SPD", org: 24, reg: 32 },
      { abbr: "GRN", org: 16, reg: 21 },
      { abbr: "CDU", org: 10, reg: 17 },
      { abbr: "LNK", org: 6, reg: 8 },
      { abbr: "FDP", org: 4, reg: 5 },
    ],
    independent: 10,
    unregistered: 7,
    unaffiliatedOrg: 40,
  },
  {
    stateId: "HH",
    parties: [
      { abbr: "SPD", org: 23, reg: 30 },
      { abbr: "GRN", org: 18, reg: 25 },
      { abbr: "CDU", org: 9, reg: 15 },
      { abbr: "FDP", org: 6, reg: 8 },
      { abbr: "LNK", org: 5, reg: 7 },
    ],
    independent: 9,
    unregistered: 6,
    unaffiliatedOrg: 39,
  },
  {
    stateId: "HE",
    parties: [
      { abbr: "SPD", org: 20, reg: 28 },
      { abbr: "CDU", org: 17, reg: 23 },
      { abbr: "GRN", org: 12, reg: 16 },
      { abbr: "FDP", org: 9, reg: 11 },
      { abbr: "AFD", org: 5, reg: 8 },
    ],
    independent: 9,
    unregistered: 5,
    unaffiliatedOrg: 37,
  },
  {
    stateId: "NI",
    parties: [
      { abbr: "SPD", org: 23, reg: 32 },
      { abbr: "CDU", org: 15, reg: 23 },
      { abbr: "GRN", org: 11, reg: 16 },
      { abbr: "FDP", org: 7, reg: 10 },
      { abbr: "AFD", org: 5, reg: 7 },
    ],
    independent: 8,
    unregistered: 4,
    unaffiliatedOrg: 39,
  },
  {
    stateId: "NW",
    parties: [
      { abbr: "SPD", org: 21, reg: 29 },
      { abbr: "CDU", org: 19, reg: 27 },
      { abbr: "GRN", org: 12, reg: 16 },
      { abbr: "FDP", org: 8, reg: 10 },
      { abbr: "AFD", org: 4, reg: 7 },
    ],
    independent: 7,
    unregistered: 4,
    unaffiliatedOrg: 36,
  },
  {
    stateId: "RP",
    parties: [
      { abbr: "SPD", org: 21, reg: 30 },
      { abbr: "CDU", org: 18, reg: 25 },
      { abbr: "FDP", org: 8, reg: 11 },
      { abbr: "GRN", org: 9, reg: 13 },
      { abbr: "AFD", org: 5, reg: 8 },
    ],
    independent: 8,
    unregistered: 5,
    unaffiliatedOrg: 39,
  },
  {
    stateId: "SL",
    parties: [
      { abbr: "SPD", org: 27, reg: 37 },
      { abbr: "CDU", org: 14, reg: 23 },
      { abbr: "AFD", org: 5, reg: 10 },
      { abbr: "FDP", org: 5, reg: 7 },
      { abbr: "LNK", org: 5, reg: 7 },
    ],
    independent: 10,
    unregistered: 6,
    unaffiliatedOrg: 44,
  },
  {
    stateId: "MV",
    parties: [
      { abbr: "SPD", org: 21, reg: 29 },
      { abbr: "AFD", org: 11, reg: 18 },
      { abbr: "CDU", org: 8, reg: 17 },
      { abbr: "LNK", org: 8, reg: 11 },
      { abbr: "GRN", org: 3, reg: 6 },
      { abbr: "FDP", org: 0, reg: 4 },
    ],
    independent: 9,
    unregistered: 6,
    unaffiliatedOrg: 49,
  },
  {
    stateId: "SN",
    parties: [
      { abbr: "AFD", org: 16, reg: 25 },
      { abbr: "CDU", org: 12, reg: 17 },
      { abbr: "SPD", org: 10, reg: 19 },
      { abbr: "LNK", org: 7, reg: 9 },
      { abbr: "FDP", org: 5, reg: 6 },
      { abbr: "GRN", org: 0, reg: 6 },
    ],
    independent: 11,
    unregistered: 7,
    unaffiliatedOrg: 50,
  },
  {
    stateId: "ST",
    parties: [
      { abbr: "AFD", org: 14, reg: 20 },
      { abbr: "SPD", org: 12, reg: 24 },
      { abbr: "CDU", org: 12, reg: 21 },
      { abbr: "LNK", org: 8, reg: 10 },
      { abbr: "FDP", org: 4, reg: 5 },
      { abbr: "GRN", org: 0, reg: 4 },
    ],
    independent: 9,
    unregistered: 7,
    unaffiliatedOrg: 50,
  },
  {
    stateId: "SH",
    parties: [
      { abbr: "SPD", org: 18, reg: 28 },
      { abbr: "CDU", org: 17, reg: 22 },
      { abbr: "GRN", org: 13, reg: 18 },
      { abbr: "FDP", org: 9, reg: 11 },
      { abbr: "AFD", org: 3, reg: 6 },
    ],
    independent: 10,
    unregistered: 5,
    unaffiliatedOrg: 40,
  },
  {
    stateId: "TH",
    parties: [
      { abbr: "AFD", org: 15, reg: 24 },
      { abbr: "SPD", org: 10, reg: 22 },
      { abbr: "CDU", org: 10, reg: 17 },
      { abbr: "LNK", org: 10, reg: 12 },
      { abbr: "FDP", org: 4, reg: 5 },
      { abbr: "GRN", org: 0, reg: 4 },
    ],
    independent: 9,
    unregistered: 7,
    unaffiliatedOrg: 51,
  },
];

export function buildAllRegistrationSeeds(): StateRegistrationSeed[] {
  return [
    ...buildUSSeeds(),
    ...UK_SEEDS.map((s) => ({ ...s, countryId: "UK" as const })),
    ...JP_SEEDS.map((s) => ({ ...s, countryId: "JP" as const })),
    ...DE_SEEDS.map((s) => ({ ...s, countryId: "DE" as const })),
  ];
}

/**
 * Validates a single seed row against the design doc invariants:
 *   - Σ partyReg + independent + unregistered = 100
 *   - Σ partyOrg + unaffiliatedOrg            = 100
 * Returns null when valid; otherwise an explanatory string.
 */
export function validateSeed(seed: StateRegistrationSeed, tolerance = 0.5): string | null {
  const sumOrg = seed.parties.reduce((s, p) => s + p.org, 0) + seed.unaffiliatedOrg;
  const sumReg = seed.parties.reduce((s, p) => s + p.reg, 0) + seed.independent + seed.unregistered;
  if (Math.abs(sumOrg - 100) > tolerance) {
    return `${seed.countryId}/${seed.stateId} Org sum is ${sumOrg.toFixed(2)} (expected 100)`;
  }
  if (Math.abs(sumReg - 100) > tolerance) {
    return `${seed.countryId}/${seed.stateId} Reg sum is ${sumReg.toFixed(2)} (expected 100)`;
  }
  return null;
}
