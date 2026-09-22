import type { State } from "@/lib/db/types";

/**
 * USSR regions as State-compatible documents — 1953 (Stalin's death year).
 *
 * SEED INDEPENDENCE — DO NOT DERIVE FROM ANOTHER ERA.
 * Values are authored for ~1953 directly (1939/1950 Soviet census data,
 * 1953 economic output estimates). NOT imported or transformed from ruRegions.ts.
 *
 * Population: 148,500,000 across 14 regions. Ukraine, Byelorussia and the
 * Baltics used to sit here as RU regions (UKR/BEL/BLT). They are now their own
 * playable Eastern Bloc countries (UKR/BLR/BAL) with their own region shards,
 * so RU keeps the ten RSFSR macro-regions plus Kazakhstan, Transcaucasia,
 * Central Asia and Moldova. The remainder still models the Union rather than
 * the RSFSR alone: those four were constituent union republics, NOT sovereign
 * satellite states like PL/RO/HU/DD/CS/BG.
 * Stalin died March 5, 1953. Korean War armistice July 1953.
 * Economy was substantially more agrarian than 1979 — collectivization complete
 * but industrialization still in progress.
 *
 * GDP BASIS (political-legislation spec §4.1 re-scale ruling): regional GDPs are
 * ×4.417 re-scaled off the original 1953 output-share authoring, so that one GDP
 * truth serves the budget page, the metrics system and the law cost engine. The
 * rollup is now ₽1,029,166M rather than the original ₽1.4T, because the three
 * departed republics took ₽370,834M with them (UKR 291,667 + BEL 50,000 +
 * BLT 29,167). The FY-1953 budget seed's national GDP is reduced to match
 * (see src/lib/seeds/reference/budgets.ts and reconcileStateGdp.ts).
 *
 * houseDistricts = Soviet of the Union seats (sum = 526). The real 1954
 * convocation seated 708, but 182 of those seats belonged to the constituencies
 * now owned by UKR (145), BLR (27) and BAL (10), which elect their own chambers.
 * Apportionment within RU is pop-proportional by largest remainder, unchanged.
 * stateSenateSeats = regional Supreme Soviet seats.
 */
export const ruRegions1953: State[] = [
  // ── RSFSR (Russia) economic macro-regions ──────────────────────────────────
  {
    _id: "CEN",
    countryId: "RU",
    regionType: "state",
    name: "Central Russia",
    population: 22_500_000,
    gdp: 179_167,
    houseDistricts: 80,
    stateSenateSeats: 575,
    region: "Russia",
    votingSystem: "fptp",
  },
  {
    _id: "NWR",
    countryId: "RU",
    regionType: "state",
    name: "Northwest Russia",
    population: 10_500_000,
    gdp: 91_667,
    houseDistricts: 37,
    stateSenateSeats: 266,
    region: "Russia",
    votingSystem: "fptp",
  },
  {
    _id: "NOR",
    countryId: "RU",
    regionType: "state",
    name: "European North",
    population: 4_800_000,
    gdp: 33_333,
    houseDistricts: 17,
    stateSenateSeats: 123,
    region: "Russia",
    votingSystem: "fptp",
  },
  {
    _id: "CBE",
    countryId: "RU",
    regionType: "state",
    name: "Central Black Earth",
    population: 8_500_000,
    gdp: 37_500,
    houseDistricts: 30,
    stateSenateSeats: 164,
    region: "Russia",
    votingSystem: "fptp",
  },
  {
    _id: "VOL",
    countryId: "RU",
    regionType: "state",
    name: "Volga",
    population: 17_000_000,
    gdp: 116_667,
    houseDistricts: 60,
    stateSenateSeats: 410,
    region: "Russia",
    votingSystem: "fptp",
  },
  {
    _id: "NCA",
    countryId: "RU",
    regionType: "state",
    name: "North Caucasus",
    population: 13_000_000,
    gdp: 66_667,
    houseDistricts: 46,
    stateSenateSeats: 307,
    region: "Russia",
    votingSystem: "fptp",
  },
  {
    _id: "URA",
    countryId: "RU",
    regionType: "state",
    name: "Urals",
    population: 15_500_000,
    gdp: 158_333,
    houseDistricts: 55,
    stateSenateSeats: 389,
    region: "Russia",
    votingSystem: "fptp",
  },
  {
    _id: "WSB",
    countryId: "RU",
    regionType: "state",
    name: "West Siberia",
    population: 9_500_000,
    gdp: 83_333,
    houseDistricts: 34,
    stateSenateSeats: 246,
    region: "Russia",
    votingSystem: "fptp",
  },
  {
    _id: "ESB",
    countryId: "RU",
    regionType: "state",
    name: "East Siberia",
    population: 6_000_000,
    gdp: 45_833,
    houseDistricts: 21,
    stateSenateSeats: 164,
    region: "Russia",
    votingSystem: "fptp",
  },
  {
    _id: "FEA",
    countryId: "RU",
    regionType: "state",
    name: "Russian Far East",
    population: 5_200_000,
    gdp: 41_667,
    houseDistricts: 18,
    stateSenateSeats: 143,
    region: "Russia",
    votingSystem: "fptp",
  },
  // ── Union republics (grouped) ──────────────────────────────────────────────
  {
    _id: "KAZ",
    countryId: "RU",
    regionType: "state",
    name: "Kazakhstan",
    population: 8_500_000,
    gdp: 45_833,
    houseDistricts: 30,
    stateSenateSeats: 510,
    region: "Kazakhstan",
    votingSystem: "fptp",
  },
  {
    _id: "TRA",
    countryId: "RU",
    regionType: "state",
    name: "Transcaucasia",
    population: 11_000_000,
    gdp: 58_333,
    houseDistricts: 39,
    stateSenateSeats: 440,
    region: "Caucasus",
    votingSystem: "fptp",
  },
  {
    _id: "CAS",
    countryId: "RU",
    regionType: "state",
    name: "Central Asia",
    population: 14_000_000,
    gdp: 58_333,
    houseDistricts: 50,
    stateSenateSeats: 500,
    region: "Central Asia",
    votingSystem: "fptp",
  },
  {
    _id: "MOL",
    countryId: "RU",
    regionType: "state",
    name: "Moldova",
    population: 2_500_000,
    gdp: 12_500,
    houseDistricts: 9,
    stateSenateSeats: 350,
    region: "Moldova",
    votingSystem: "fptp",
  },
];

export default ruRegions1953;
