import type { State } from "@/lib/db/types";

/**
 * German Bundesländer as State-compatible documents.
 *
 * The 16 federal states are the playable sub-national units. Each state
 * elects a Landtag (regional assembly) and contributes a share of the
 * 299 Bundestag Wahlkreise (single-member constituencies) used as the
 * direct-mandate pool for AMS seat allocation.
 *
 * - `population` — 2023 demographic estimates (people).
 * - `gdp` — 2022 state GDP in millions of EUR.
 * - `houseDistricts` — Bundestag Wahlkreise allocated to the state
 *     (must sum to 299 across all 16 states).
 * - `stateSenateSeats` — Landtag seat count (Bremen + Hamburg use
 *     Bürgerschaft sizes; Berlin uses the Abgeordnetenhaus).
 * - `region` — north/south/east/west grouping used for regional filters.
 * - `votingSystem` — FPTP for the Wahlkreis direct mandates. The list
 *     tier runs Sainte-Laguë via germanyAMS.ts, not via State.votingSystem.
 */
export const deRegions: State[] = [
  // ── Süden (South) ──────────────────────────────────────────────────────────
  {
    _id: "BW",
    countryId: "DE",
    regionType: "state",
    name: "Baden-Württemberg",
    population: 11_280_000,
    gdp: 579_000,
    houseDistricts: 38,
    stateSenateSeats: 154,
    region: "Süden",
    votingSystem: "fptp",
  },
  {
    _id: "BY",
    countryId: "DE",
    regionType: "state",
    name: "Bayern",
    population: 13_176_000,
    gdp: 716_000,
    houseDistricts: 47,
    stateSenateSeats: 203,
    region: "Süden",
    votingSystem: "fptp",
  },

  // ── Westen (West) ──────────────────────────────────────────────────────────
  {
    _id: "NW",
    countryId: "DE",
    regionType: "state",
    name: "Nordrhein-Westfalen",
    population: 18_140_000,
    gdp: 774_000,
    houseDistricts: 64,
    stateSenateSeats: 195,
    region: "Westen",
    votingSystem: "fptp",
  },
  {
    _id: "HE",
    countryId: "DE",
    regionType: "state",
    name: "Hessen",
    population: 6_392_000,
    gdp: 321_000,
    houseDistricts: 22,
    stateSenateSeats: 137,
    region: "Westen",
    votingSystem: "fptp",
  },
  {
    _id: "RP",
    countryId: "DE",
    regionType: "state",
    name: "Rheinland-Pfalz",
    population: 4_162_000,
    gdp: 170_000,
    houseDistricts: 15,
    stateSenateSeats: 101,
    region: "Westen",
    votingSystem: "fptp",
  },
  {
    _id: "SL",
    countryId: "DE",
    regionType: "state",
    name: "Saarland",
    population: 993_000,
    gdp: 37_000,
    houseDistricts: 4,
    stateSenateSeats: 51,
    region: "Westen",
    votingSystem: "fptp",
  },

  // ── Norden (North) ─────────────────────────────────────────────────────────
  {
    _id: "NI",
    countryId: "DE",
    regionType: "state",
    name: "Niedersachsen",
    population: 8_141_000,
    gdp: 345_000,
    houseDistricts: 30,
    stateSenateSeats: 146,
    region: "Norden",
    votingSystem: "fptp",
  },
  {
    _id: "SH",
    countryId: "DE",
    regionType: "state",
    name: "Schleswig-Holstein",
    population: 2_933_000,
    gdp: 108_000,
    houseDistricts: 11,
    stateSenateSeats: 73,
    region: "Norden",
    votingSystem: "fptp",
  },
  {
    _id: "HH",
    countryId: "DE",
    regionType: "state",
    name: "Hamburg",
    population: 1_930_000,
    gdp: 142_000,
    houseDistricts: 6,
    stateSenateSeats: 123,
    region: "Norden",
    votingSystem: "fptp",
  },
  {
    _id: "BRE",
    countryId: "DE",
    regionType: "state",
    name: "Bremen",
    population: 685_000,
    gdp: 35_000,
    houseDistricts: 2,
    stateSenateSeats: 87,
    region: "Norden",
    votingSystem: "fptp",
  },

  // ── Osten (East) ───────────────────────────────────────────────────────────
  {
    _id: "BE",
    countryId: "DE",
    regionType: "state",
    name: "Berlin",
    population: 3_850_000,
    gdp: 180_000,
    houseDistricts: 12,
    stateSenateSeats: 159,
    region: "Osten",
    votingSystem: "fptp",
  },
  {
    _id: "BB",
    countryId: "DE",
    regionType: "state",
    name: "Brandenburg",
    population: 2_573_000,
    gdp: 85_000,
    houseDistricts: 10,
    stateSenateSeats: 88,
    region: "Osten",
    votingSystem: "fptp",
  },
  {
    _id: "MV",
    countryId: "DE",
    regionType: "state",
    name: "Mecklenburg-Vorpommern",
    population: 1_624_000,
    gdp: 52_000,
    houseDistricts: 6,
    stateSenateSeats: 79,
    region: "Osten",
    votingSystem: "fptp",
  },
  {
    _id: "SN",
    countryId: "DE",
    regionType: "state",
    name: "Sachsen",
    population: 4_057_000,
    gdp: 145_000,
    houseDistricts: 16,
    stateSenateSeats: 120,
    region: "Osten",
    votingSystem: "fptp",
  },
  {
    _id: "ST",
    countryId: "DE",
    regionType: "state",
    name: "Sachsen-Anhalt",
    population: 2_186_000,
    gdp: 74_000,
    houseDistricts: 8,
    stateSenateSeats: 97,
    region: "Osten",
    votingSystem: "fptp",
  },
  {
    _id: "TH",
    countryId: "DE",
    regionType: "state",
    name: "Thüringen",
    population: 2_115_000,
    gdp: 68_000,
    houseDistricts: 8,
    stateSenateSeats: 88,
    region: "Osten",
    votingSystem: "fptp",
  },
];

/**
 * Bundestag Wahlkreise per state — denormalized for fast lookup during
 * election spawning. Must agree with `deRegions[*].houseDistricts`.
 *
 * Total: 299 (fixed by 2023 Wahlrechtsreform).
 */
export const DE_WAHLKREISE_PER_LAND: Record<string, number> = Object.fromEntries(
  deRegions.map((r) => [r._id, r.houseDistricts])
);
