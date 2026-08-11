import type { State } from "@/lib/db/types";

/**
 * Sweden regions — 1953 era.
 * Anchored on 1950 Census (population 7.04M) and the bicameral Riksdag of 1952:
 *   Second Chamber (Andra kammaren): 230 seats → houseDistricts
 *   First Chamber (Första kammaren): 150 seats → stateSenateSeats
 * GDP in millions of SEK (Sweden's GDP ≈ 35,000M SEK in 1950).
 * Social Democrats dominant; Cold War neutrality under Erlander.
 * SEED INDEPENDENCE — no imports from any other era file.
 */
export const seRegions1953: State[] = [
  {
    _id: "SE_STH",
    countryId: "SE",
    regionType: "state",
    name: "Stockholm",
    population: 1_260_000,
    gdp: 11_600,
    houseDistricts: 40,
    stateSenateSeats: 26,
    region: "Stockholm",
    votingSystem: "rcv",
  },
  {
    _id: "SE_GOT",
    countryId: "SE",
    regionType: "state",
    name: "Western Sweden",
    population: 1_000_000,
    gdp: 7_000,
    houseDistricts: 32,
    stateSenateSeats: 21,
    region: "West",
    votingSystem: "rcv",
  },
  {
    _id: "SE_SKA",
    countryId: "SE",
    regionType: "state",
    name: "Skåne",
    population: 950_000,
    gdp: 5_250,
    houseDistricts: 31,
    stateSenateSeats: 20,
    region: "South",
    votingSystem: "rcv",
  },
  {
    _id: "SE_EAS",
    countryId: "SE",
    regionType: "state",
    name: "Eastern Sweden",
    population: 750_000,
    gdp: 3_850,
    houseDistricts: 24,
    stateSenateSeats: 16,
    region: "East",
    votingSystem: "rcv",
  },
  {
    _id: "SE_SML",
    countryId: "SE",
    regionType: "state",
    name: "Småland",
    population: 700_000,
    gdp: 2_800,
    houseDistricts: 22,
    stateSenateSeats: 15,
    region: "Southeast",
    votingSystem: "rcv",
  },
  {
    _id: "SE_VML",
    countryId: "SE",
    regionType: "state",
    name: "Bergslagen",
    population: 700_000,
    gdp: 2_450,
    houseDistricts: 22,
    stateSenateSeats: 15,
    region: "Central",
    votingSystem: "rcv",
  },
  {
    _id: "SE_NOR",
    countryId: "SE",
    regionType: "state",
    name: "Norrland",
    population: 1_300_000,
    gdp: 2_100,
    houseDistricts: 42,
    stateSenateSeats: 26,
    region: "North",
    votingSystem: "rcv",
  },
  {
    _id: "SE_UPP",
    countryId: "SE",
    regionType: "state",
    name: "Uppland & Dalarna",
    population: 500_000,
    gdp: 2_100,
    houseDistricts: 17,
    stateSenateSeats: 11,
    region: "North-Central",
    votingSystem: "rcv",
  },
];

export default seRegions1953;
