/**
 * Canonical US state constants for congressional and election logic.
 * Single source of truth — import from here or @/lib/constants.
 */

/** House seat counts by state (2020 census apportionment). Sum = 435. */
export const HOUSE_SEATS: Record<string, number> = {
  AL: 7,
  AK: 1,
  AZ: 9,
  AR: 4,
  CA: 52,
  CO: 8,
  CT: 5,
  DE: 1,
  FL: 28,
  GA: 14,
  HI: 2,
  ID: 2,
  IL: 17,
  IN: 9,
  IA: 4,
  KS: 4,
  KY: 6,
  LA: 6,
  ME: 2,
  MD: 8,
  MA: 9,
  MI: 13,
  MN: 8,
  MS: 4,
  MO: 8,
  MT: 2,
  NE: 3,
  NV: 4,
  NH: 2,
  NJ: 12,
  NM: 3,
  NY: 26,
  NC: 14,
  ND: 1,
  OH: 15,
  OK: 5,
  OR: 6,
  PA: 17,
  RI: 2,
  SC: 7,
  SD: 1,
  TN: 9,
  TX: 38,
  UT: 4,
  VT: 1,
  VA: 11,
  WA: 10,
  WV: 2,
  WI: 8,
  WY: 1,
};

/**
 * House seat counts by state — 1950 census apportionment (in force for the 83rd
 * through 87th Congresses, 1953-1963). Sum = 435 across the 48 contiguous states.
 *
 * Alaska and Hawaii are DELIBERATELY ABSENT: both were territories in 1953 (they
 * gained statehood in 1959), so they had no House delegation, no Senators, no
 * state governor and no electoral votes. `seedSeats` skips any US state absent
 * from the active-era apportionment map, which is how their pre-statehood
 * "territory" status is represented for the 1953 preset. DC likewise elects no
 * House member (and, pre-23rd-Amendment, cast no electoral votes — see
 * ELECTORAL_VOTES_1953).
 */
export const HOUSE_SEATS_1953: Record<string, number> = {
  AL: 9,
  AZ: 2,
  AR: 6,
  CA: 30,
  CO: 4,
  CT: 6,
  DE: 1,
  FL: 8,
  GA: 10,
  ID: 2,
  IL: 25,
  IN: 11,
  IA: 8,
  KS: 6,
  KY: 8,
  LA: 8,
  ME: 3,
  MD: 7,
  MA: 14,
  MI: 18,
  MN: 9,
  MS: 6,
  MO: 11,
  MT: 2,
  NE: 4,
  NV: 1,
  NH: 2,
  NJ: 14,
  NM: 2,
  NY: 43,
  NC: 12,
  ND: 2,
  OH: 23,
  OK: 6,
  OR: 4,
  PA: 30,
  RI: 2,
  SC: 6,
  SD: 2,
  TN: 9,
  TX: 22,
  UT: 2,
  VT: 1,
  VA: 10,
  WA: 7,
  WV: 6,
  WI: 10,
  WY: 1,
};

/** Senate class assignments per state (Class 1: 33, Class 2: 33, Class 3: 34 seats). */
export const SENATE_CLASSES_BY_STATE: Record<string, [1 | 2 | 3, 1 | 2 | 3]> = {
  AL: [2, 3],
  AK: [2, 3],
  AZ: [1, 3],
  AR: [2, 3],
  CA: [1, 3],
  CO: [2, 3],
  CT: [1, 3],
  DE: [1, 2],
  FL: [1, 3],
  GA: [2, 3],
  HI: [1, 3],
  ID: [2, 3],
  IL: [2, 3],
  IN: [1, 3],
  IA: [2, 3],
  KS: [2, 3],
  KY: [2, 3],
  LA: [2, 3],
  ME: [1, 2],
  MD: [1, 3],
  MA: [1, 2],
  MI: [1, 2],
  MN: [1, 2],
  MS: [1, 2],
  MO: [1, 3],
  MT: [1, 2],
  NE: [1, 2],
  NV: [1, 3],
  NH: [2, 3],
  NJ: [1, 2],
  NM: [1, 2],
  NY: [1, 3],
  NC: [2, 3],
  ND: [1, 3],
  OH: [1, 3],
  OK: [2, 3],
  OR: [2, 3],
  PA: [1, 3],
  RI: [1, 2],
  SC: [2, 3],
  SD: [2, 3],
  TN: [1, 2],
  TX: [1, 2],
  UT: [1, 3],
  VT: [1, 3],
  VA: [1, 2],
  WA: [1, 3],
  WV: [1, 2],
  WI: [1, 3],
  WY: [1, 2],
};

/** State Senate seat counts by state (for state senate elections). */
export const STATE_SENATE_SEATS: Record<string, number> = {
  AL: 35,
  AK: 20,
  AZ: 30,
  AR: 35,
  CA: 40,
  CO: 35,
  CT: 36,
  DE: 21,
  FL: 40,
  GA: 56,
  HI: 25,
  ID: 35,
  IL: 59,
  IN: 50,
  IA: 50,
  KS: 40,
  KY: 38,
  LA: 39,
  ME: 35,
  MD: 47,
  MA: 40,
  MI: 38,
  MN: 67,
  MS: 52,
  MO: 34,
  MT: 50,
  NE: 49,
  NV: 21,
  NH: 24,
  NJ: 40,
  NM: 42,
  NY: 63,
  NC: 50,
  ND: 47,
  OH: 33,
  OK: 48,
  OR: 30,
  PA: 50,
  RI: 38,
  SC: 46,
  SD: 35,
  TN: 33,
  TX: 31,
  UT: 29,
  VT: 30,
  VA: 40,
  WA: 49,
  WV: 34,
  WI: 33,
  WY: 30,
};

export const TOTAL_HOUSE_SEATS = 435;
export const TOTAL_SENATE_SEATS = 100;

/**
 * UK Commons seat counts by region (Westminster constituencies per NUTS1 region).
 * Matches ukRegions.houseDistricts. Sum = 652 (ONS 2023 boundary review).
 * Mirrors HOUSE_SEATS for the UK parliamentary system.
 */
export const UK_COMMONS_SEATS: Record<string, number> = {
  LON: 75,
  SEE: 90,
  SWE: 58,
  EAE: 60,
  EMI: 47,
  WMI: 57,
  YHU: 54,
  NWE: 75,
  NEE: 27,
  SCO: 57,
  WAL: 32,
  NIR: 18,
};

export const TOTAL_UK_COMMONS_SEATS = 650;

/** RU (Soviet Union) region id → display name. Matches ruRegions seed names. */
export const RU_REGION_NAMES: Record<string, string> = {
  CEN: "Central Russia",
  NWR: "Northwest Russia",
  NOR: "European North",
  CBE: "Central Black Earth",
  VOL: "Volga",
  NCA: "North Caucasus",
  URA: "Urals",
  WSB: "West Siberia",
  ESB: "East Siberia",
  FEA: "Russian Far East",
  UKR: "Ukraine",
  KAZ: "Kazakhstan",
  TRA: "Transcaucasia",
  CAS: "Central Asia",
  MOL: "Moldova",
  BEL: "Byelorussia",
  BLT: "Baltic Republics",
};

/** UK region id → display name. Matches ukRegions seed names. */
export const UK_REGION_NAMES: Record<string, string> = {
  LON: "London",
  SEE: "South East England",
  SWE: "South West England",
  EAE: "East of England",
  EMI: "East Midlands",
  WMI: "West Midlands",
  YHU: "Yorkshire & the Humber",
  NWE: "North West England",
  NEE: "North East England",
  SCO: "Scotland",
  WAL: "Wales",
  NIR: "Northern Ireland",
};

/**
 * UK Regional Council seat counts by region.
 * Regional councils are elected on the same cycle as Commons.
 */
export const UK_REGIONAL_COUNCIL_SEATS: Record<string, number> = {
  LON: 32,
  SEE: 67,
  SWE: 39,
  EAE: 39,
  EMI: 39,
  WMI: 18,
  YHU: 21,
  NWE: 27,
  NEE: 17,
  SCO: 129,
  WAL: 60,
  NIR: 90,
};

/**
 * NG State House of Assembly seats per geopolitical zone — 990 total (real
 * Nigerian State Assembly size), allocated by zone population (largest-remainder).
 */
export const NG_REGIONAL_COUNCIL_SEATS: Record<string, number> = {
  NORTH_WEST: 259,
  NORTH_EAST: 137,
  NORTH_CENTRAL: 146,
  SOUTH_WEST: 197,
  SOUTH_SOUTH: 134,
  SOUTH_EAST: 117,
};

// ── Japan seat counts ────────────────────────────────────────────────────────

/** Shugiin (House of Representatives) seat counts per region. Total = 465. */
export const JP_SHUGIIN_SEATS: Record<string, number> = {
  HOK: 12,
  TOH: 37,
  KAN: 150,
  CHU: 81,
  KNS: 82,
  CGK: 28,
  SHI: 14,
  KYU: 61,
};

export const TOTAL_JP_SHUGIIN_SEATS = 465;

// ── China seat counts ────────────────────────────────────────────────────────

/**
 * NPC Delegate seats per macro-region for the MODERN apportionment
 * (2019/1991/1979 presets). Mirrors `cnRegions[i].houseDistricts` so the
 * perpetual-election spawner can pull total seats without importing the regions
 * seed at the constants layer. Total = 2980.
 *
 * Read through {@link getCnNpcSeats}, never directly — a 1953 world seats a
 * 1,226-deputy chamber, not this one.
 */
export const CN_NPC_SEATS: Record<string, number> = {
  DB: 238,
  HB: 323,
  HD: 922,
  HZ: 395,
  HN: 316,
  XN: 466,
  XB: 320,
};

export const TOTAL_CN_NPC_SEATS = 2980;

/**
 * NPC Delegate seats per macro-region for `1953-default` — the 1,226-deputy
 * allocation of the 1st National People's Congress (1954 convocation).
 *
 * Mirrors `cnRegions1953[i].houseDistricts` EXACTLY (88/129/379/215/118/219/78),
 * which is also what `COUNTRY_CONFIGS.CN.legislature.lowerChamber` declares for
 * this preset and what `CN_NPC_1953` in `historicalSeats.ts` seats (#3781).
 * Before this map existed, `ensureCNElections` sized the 1953 race off the
 * modern 2,980 while every other era-aware source said 1,226, so the first CN
 * election in a 1953 world would have resolved ~1,750 phantom deputies into the
 * chamber (#3779 — the same over-seating class as bug #0853).
 */
export const CN_NPC_SEATS_1953: Record<string, number> = {
  DB: 88,
  HB: 129,
  HD: 379,
  HZ: 215,
  HN: 118,
  XN: 219,
  XB: 78,
};

export const TOTAL_CN_NPC_SEATS_1953 = 1226;

/**
 * Provincial People's Congress seats per macro-region, modern apportionment.
 * Total = 4000. Sub-national legislature, contested separately from the
 * national NPC. Sized roughly proportional to NPC apportionment, scaled up to
 * reflect real-world provincial people's congresses (each ~700-900 delegates).
 *
 * Read through {@link getCnPeoplesCongressSeats}, never directly.
 */
export const CN_PEOPLES_CONGRESS_SEATS: Record<string, number> = {
  DB: 321,
  HB: 433,
  HD: 1240,
  HZ: 533,
  HN: 425,
  XN: 625,
  XB: 423,
};

export const TOTAL_CN_PEOPLES_CONGRESS_SEATS = 4000;

/**
 * Provincial People's Congress seats per macro-region for `1953-default`.
 * Total = 3781. Mirrors `cnRegions1953[i].stateSenateSeats` EXACTLY — that
 * field carries the era's provincial-congress allocation, so the 1953 seed and
 * this map agree by construction (unlike the modern eras, where
 * `stateSenateSeats` holds the separate, smaller appointed CPPCC allocation and
 * the map deliberately overrides it — bug #0853).
 */
export const CN_PEOPLES_CONGRESS_SEATS_1953: Record<string, number> = {
  DB: 270,
  HB: 395,
  HD: 1164,
  HZ: 678,
  HN: 362,
  XN: 673,
  XB: 239,
};

export const TOTAL_CN_PEOPLES_CONGRESS_SEATS_1953 = 3781;

/**
 * Preset-aware CN apportionment selectors. Same shape and same fall-back-to-
 * modern convention as {@link getHouseSeats} / {@link getElectoralVotes}:
 * `1953-default` → the 1st-NPC bundle; everything else (`1979-default`,
 * `1991-default`, `2019-default`, `empty`, unknown, undefined) → the modern
 * bundle, which is what those eras all authored.
 */
export function getCnNpcSeats(preset: string | undefined): Record<string, number> {
  return preset === "1953-default" ? CN_NPC_SEATS_1953 : CN_NPC_SEATS;
}

export function getCnPeoplesCongressSeats(preset: string | undefined): Record<string, number> {
  return preset === "1953-default" ? CN_PEOPLES_CONGRESS_SEATS_1953 : CN_PEOPLES_CONGRESS_SEATS;
}

/**
 * Total seats in a region's sub-national legislature — the elected chamber whose
 * composition the region legislature page renders, whose vacancies the seat
 * appointer validates against, and whose size sets state-bill majorities.
 *
 * For China this is the Provincial People's Congress
 * (`getCnPeoplesCongressSeats(preset)`), NOT the State's `stateSenateSeats`
 * field — for CN in the modern eras that field holds the separate, appointed
 * CPPCC allocation (~half the size). Every other country's sub-national chamber
 * (US State Senate, DE Landtag, …) is sized by `stateSenateSeats`.
 *
 * This is the single source of truth shared by the seat appointer, the public
 * legislature API, and state-bill vote math, so they can never disagree with the
 * election system — which sizes CN People's Congress races from the same
 * selector. Sizing the People's Congress off `stateSenateSeats` was bug #0853: a
 * region's parties summed to more seats (e.g. 317) than the displayed cap (175).
 *
 * `preset` is optional only so non-CN callers (every country but China) need not
 * plumb it; ALWAYS pass it when the country can be CN, or a 1953 world reads the
 * modern chamber size.
 */
export function subNationalChamberSeats(
  countryId: string,
  state: { _id: string; stateSenateSeats?: number | null },
  preset?: string
): number {
  if (countryId === "CN") {
    return getCnPeoplesCongressSeats(preset)[state._id] ?? state.stateSenateSeats ?? 0;
  }
  return state.stateSenateSeats ?? 0;
}

/** Sangiin (House of Councillors) seat counts per region. Total = 248. */
export const JP_SANGIIN_SEATS: Record<string, number> = {
  HOK: 7,
  TOH: 20,
  KAN: 80,
  CHU: 44,
  KNS: 44,
  CGK: 14,
  SHI: 8,
  KYU: 31,
};

export const TOTAL_JP_SANGIIN_SEATS = 248;

// ── Germany seat counts ──────────────────────────────────────────────────────

/**
 * Bundestag Wahlkreise (single-member constituencies) per Bundesland.
 * Direct-mandate tier of the AMS/MMP system. Sum = 299.
 * Mirrors `deRegions[*].houseDistricts`.
 */
export const DE_WAHLKREIS_SEATS: Record<string, number> = {
  BW: 38,
  BY: 47,
  BE: 12,
  BB: 10,
  BRE: 2,
  HH: 6,
  HE: 22,
  MV: 6,
  NI: 30,
  NW: 64,
  RP: 15,
  SL: 4,
  SN: 16,
  ST: 8,
  SH: 11,
  TH: 8,
};

/** Total Wahlkreise contested nationwide. Fixed under 2023 reform. */
export const TOTAL_DE_WAHLKREIS_SEATS = 299;

/**
 * Total Bundestag seats including list tier.
 * Capped under the 2023 Wahlrechtsreform — direct + list combined.
 */
export const TOTAL_DE_BUNDESTAG_SEATS = 630;

/** Landtag seat counts per Bundesland. Mirrors deRegions[*].stateSenateSeats. */
export const DE_LANDTAG_SEATS: Record<string, number> = {
  BW: 154,
  BY: 203,
  BE: 159,
  BB: 88,
  BRE: 87,
  HH: 123,
  HE: 137,
  MV: 79,
  NI: 146,
  NW: 195,
  RP: 101,
  SL: 51,
  SN: 120,
  ST: 97,
  SH: 73,
  TH: 88,
};

/** JP Governor seats per region. 1 governor per region. */
export const JP_GOVERNOR_SEATS: Record<string, number> = {
  HOK: 1,
  TOH: 1,
  KAN: 1,
  CHU: 1,
  KNS: 1,
  CGK: 1,
  SHI: 1,
  KYU: 1,
};

/** Electoral votes per state (House seats + 2). DC = 3. Total = 538. */
export const ELECTORAL_VOTES: Record<string, number> = {
  AL: 9,
  AK: 3,
  AZ: 11,
  AR: 6,
  CA: 54,
  CO: 10,
  CT: 7,
  DE: 3,
  FL: 30,
  GA: 16,
  HI: 4,
  ID: 4,
  IL: 19,
  IN: 11,
  IA: 6,
  KS: 6,
  KY: 8,
  LA: 8,
  ME: 4,
  MD: 10,
  MA: 11,
  MI: 15,
  MN: 10,
  MS: 6,
  MO: 10,
  MT: 4,
  NE: 5,
  NV: 6,
  NH: 4,
  NJ: 14,
  NM: 5,
  NY: 28,
  NC: 16,
  ND: 3,
  OH: 17,
  OK: 7,
  OR: 8,
  PA: 19,
  RI: 4,
  SC: 9,
  SD: 3,
  TN: 11,
  TX: 40,
  UT: 6,
  VT: 3,
  VA: 13,
  WA: 12,
  WV: 4,
  WI: 10,
  WY: 3,
  DC: 3,
};

export const TOTAL_ELECTORAL_VOTES = 538;
export const ELECTORAL_MAJORITY = 270;

/**
 * Electoral vote allocation units for presidential elections.
 * Most states: single unit (state ID) with full EV count.
 * ME/NE: split by statewide (2 EV) + congressional districts (1 EV each).
 */
export const ELECTORAL_VOTE_UNITS: { unitId: string; ev: number; stateId: string }[] = (() => {
  const units: { unitId: string; ev: number; stateId: string }[] = [];
  for (const [stateId, ev] of Object.entries(ELECTORAL_VOTES)) {
    if (stateId === "ME") {
      units.push({ unitId: "ME", ev: 2, stateId: "ME" }); // at-large
      units.push({ unitId: "ME_CD1", ev: 1, stateId: "ME" });
      units.push({ unitId: "ME_CD2", ev: 1, stateId: "ME" });
    } else if (stateId === "NE") {
      units.push({ unitId: "NE", ev: 2, stateId: "NE" }); // at-large
      units.push({ unitId: "NE_CD1", ev: 1, stateId: "NE" });
      units.push({ unitId: "NE_CD2", ev: 1, stateId: "NE" });
      units.push({ unitId: "NE_CD3", ev: 1, stateId: "NE" });
    } else {
      units.push({ unitId: stateId, ev, stateId });
    }
  }
  return units;
})();

/**
 * House seat counts by state — 1990 census apportionment (103rd Congress,
 * effective for the 1992-2000 elections). Sum = 435. Used for the
 * `1991-default` preset. Mirrors `states1991.ts` houseDistricts.
 */
export const HOUSE_SEATS_1991: Record<string, number> = {
  AL: 7,
  AK: 1,
  AZ: 6,
  AR: 4,
  CA: 52,
  CO: 6,
  CT: 6,
  DE: 1,
  FL: 23,
  GA: 11,
  HI: 2,
  ID: 2,
  IL: 20,
  IN: 10,
  IA: 5,
  KS: 4,
  KY: 6,
  LA: 7,
  ME: 2,
  MD: 8,
  MA: 10,
  MI: 16,
  MN: 8,
  MS: 5,
  MO: 9,
  MT: 1,
  NE: 3,
  NV: 2,
  NH: 2,
  NJ: 13,
  NM: 3,
  NY: 31,
  NC: 12,
  ND: 1,
  OH: 19,
  OK: 6,
  OR: 5,
  PA: 21,
  RI: 2,
  SC: 6,
  SD: 1,
  TN: 9,
  TX: 30,
  UT: 3,
  VT: 1,
  VA: 11,
  WA: 9,
  WV: 3,
  WI: 9,
  WY: 1,
};

/**
 * Electoral votes per state — 1990 census (House seats + 2; DC = 3).
 * Total = 538. Matches the 1992/1996/2000 electoral map exactly.
 */
export const ELECTORAL_VOTES_1991: Record<string, number> = {
  AL: 9,
  AK: 3,
  AZ: 8,
  AR: 6,
  CA: 54,
  CO: 8,
  CT: 8,
  DE: 3,
  FL: 25,
  GA: 13,
  HI: 4,
  ID: 4,
  IL: 22,
  IN: 12,
  IA: 7,
  KS: 6,
  KY: 8,
  LA: 9,
  ME: 4,
  MD: 10,
  MA: 12,
  MI: 18,
  MN: 10,
  MS: 7,
  MO: 11,
  MT: 3,
  NE: 5,
  NV: 4,
  NH: 4,
  NJ: 15,
  NM: 5,
  NY: 33,
  NC: 14,
  ND: 3,
  OH: 21,
  OK: 8,
  OR: 7,
  PA: 23,
  RI: 4,
  SC: 8,
  SD: 3,
  TN: 11,
  TX: 32,
  UT: 5,
  VT: 3,
  VA: 13,
  WA: 11,
  WV: 5,
  WI: 11,
  WY: 3,
  DC: 3,
};

/**
 * 1990-census electoral vote allocation units. Same ME/NE split structure as
 * the 2020 bundle (only the per-unit EV values differ).
 */
export const ELECTORAL_VOTE_UNITS_1991: { unitId: string; ev: number; stateId: string }[] = (() => {
  const units: { unitId: string; ev: number; stateId: string }[] = [];
  for (const [stateId, ev] of Object.entries(ELECTORAL_VOTES_1991)) {
    if (stateId === "ME") {
      units.push({ unitId: "ME", ev: 2, stateId: "ME" }); // at-large
      units.push({ unitId: "ME_CD1", ev: 1, stateId: "ME" });
      units.push({ unitId: "ME_CD2", ev: 1, stateId: "ME" });
    } else if (stateId === "NE") {
      units.push({ unitId: "NE", ev: 2, stateId: "NE" }); // at-large
      units.push({ unitId: "NE_CD1", ev: 1, stateId: "NE" });
      units.push({ unitId: "NE_CD2", ev: 1, stateId: "NE" });
      units.push({ unitId: "NE_CD3", ev: 1, stateId: "NE" });
    } else {
      units.push({ unitId: stateId, ev, stateId });
    }
  }
  return units;
})();

/**
 * Electoral votes per state — 1950 census (House seats + 2 Senators). Total = 531,
 * the real 1952/1956 electoral map (NY 45, CA/PA 32, IL 27, OH 25, TX 24).
 * Alaska/Hawaii (territories) and DC (no electoral votes until the 23rd Amendment,
 * 1961) are absent, so the map covers the 48 contiguous states only.
 */
export const ELECTORAL_VOTES_1953: Record<string, number> = Object.fromEntries(
  Object.entries(HOUSE_SEATS_1953).map(([stateId, houseSeats]) => [stateId, houseSeats + 2])
);

/**
 * 1950-census electoral vote allocation units. In 1952 EVERY state was
 * winner-take-all (Maine did not adopt the district method until 1972, Nebraska
 * 1992), so there are no ME/NE congressional-district splits — one unit per state.
 */
export const ELECTORAL_VOTE_UNITS_1953: { unitId: string; ev: number; stateId: string }[] =
  Object.entries(ELECTORAL_VOTES_1953).map(([stateId, ev]) => ({ unitId: stateId, ev, stateId }));

/**
 * Preset-aware apportionment selectors. `1953-default` → 1950-census bundle;
 * `1991-default` → 1990-census bundle; every other preset (`2019-default`,
 * `empty`, unknown, undefined) → the 2020-census default. Mirrors the
 * fall-back-to-2019 convention in `cycleAnchorContext.ts`.
 */
export function getHouseSeats(preset: string | undefined): Record<string, number> {
  if (preset === "1953-default") return HOUSE_SEATS_1953;
  return preset === "1991-default" ? HOUSE_SEATS_1991 : HOUSE_SEATS;
}

export function getElectoralVotes(preset: string | undefined): Record<string, number> {
  if (preset === "1953-default") return ELECTORAL_VOTES_1953;
  return preset === "1991-default" ? ELECTORAL_VOTES_1991 : ELECTORAL_VOTES;
}

export function getElectoralVoteUnits(
  preset: string | undefined
): { unitId: string; ev: number; stateId: string }[] {
  if (preset === "1953-default") return ELECTORAL_VOTE_UNITS_1953;
  return preset === "1991-default" ? ELECTORAL_VOTE_UNITS_1991 : ELECTORAL_VOTE_UNITS;
}

/**
 * District lean for ME/NE congressional districts: -1 to +1.
 * Positive = favor conservative (higher economic position); negative = favor liberal.
 * Used to shift vote distribution in presidential elections.
 */
export const UNIT_LEAN: Record<string, number> = {
  ME_CD1: -0.1, // southern Maine (Portland area), suburban/D-leaning
  ME_CD2: 0.1, // northern Maine, rural/R-leaning
  NE_CD1: -0.12, // east Omaha, urban D-leaning
  NE_CD2: -0.05, // Omaha proper, slight D-lean (Biden 2020)
  NE_CD3: 0.25, // rural west, heavily R
};

/**
 * Upper bound on the length of any region `_id` in the `states` collection,
 * for schema-layer shape checks.
 *
 * Region ids are NOT two-letter US codes worldwide: the longest currently
 * seeded is Nigeria's `NORTH_CENTRAL` at 13 characters. This constant exists
 * because two independent fixes for the same US-only-validation bug picked
 * different caps, and one of them (12) silently excluded that region. Import
 * this rather than hardcoding a number, so the bound moves with the seeds.
 *
 * This is a SHAPE bound only. The authoritative check is always a
 * country-scoped lookup against `states` — never a list held in code.
 */
export const MAX_REGION_ID_LENGTH = 15;

/** Valid state IDs (2-letter codes) for validation. */
export const STATE_IDS = Object.keys(HOUSE_SEATS) as string[];

/** Set form of {@link STATE_IDS} for O(1) membership checks. */
export const STATE_ID_SET: ReadonlySet<string> = new Set(STATE_IDS);

/**
 * True when `id` is a full US electoral state — one with congressional and
 * gubernatorial representation (the 50 `HOUSE_SEATS` states). Federal districts
 * like DC exist as economic/demographic/presidential regions (3 electoral votes)
 * but elect NO House/Senate/Governor/state-legislature seats, so they are
 * excluded. Preset-independent: `HOUSE_SEATS_1991` carries the same 50 states.
 *
 * Election generators iterate the `states` collection (which includes DC); gate
 * US House/Senate/Governor/stateSenate spawning on this to avoid fabricating
 * seats for non-electoral regions.
 */
export function isUsElectoralState(id: string): boolean {
  return STATE_ID_SET.has(id);
}

/**
 * True when `region` is a US federal district (e.g. DC) that elects no offices
 * and hosts no state party organization. Only the US has such regions, so this
 * is a no-op for every other country. Callers use it to short-circuit
 * state-party-org paths with a clean response instead of reaching the
 * `ensureStatePartyOrgRow` chokepoint, which throws for these regions.
 */
export function isNonElectoralUsRegion(country: string, region: string): boolean {
  return country === "US" && !isUsElectoralState(region);
}

/**
 * Action cost for a presidential candidate to set `travelState` or
 * `primaryCampaignState` to a given state. Scales with the state's EV count
 * so large states cost more than small ones, roughly matching real-world
 * campaign-effort budgets.
 */
export function getTravelActionCost(stateId: string, preset?: string): number {
  const ev = getElectoralVotes(preset)[stateId] ?? 3;
  if (ev <= 5) return 3;
  if (ev <= 10) return 5;
  if (ev <= 20) return 7;
  return 10;
}
