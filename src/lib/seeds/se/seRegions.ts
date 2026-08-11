import type { State } from "@/lib/db/types";

/**
 * Sweden regions as State-compatible documents (1979; Sweden is 1979-preset-only
 * here). Eight macro-regions group the 24 counties (län).
 * SEED INDEPENDENCE — ~1979 values (pop ≈ 8.3M; GDP ≈ kr 500B).
 *
 * houseDistricts = Riksdag seats (unicameral; sum = 349). stateSenateSeats holds
 * a nominal county-council weight (Sweden's Riksdag is unicameral). gdp in
 * millions of kronor.
 */
export const seRegions: State[] = [
  {
    _id: "SE_STH",
    countryId: "SE",
    regionType: "state",
    name: "Stockholm",
    population: 1_500_000,
    gdp: 130_000,
    houseDistricts: 63,
    stateSenateSeats: 30,
    region: "Stockholm",
    votingSystem: "rcv",
  },
  {
    _id: "SE_GOT",
    countryId: "SE",
    regionType: "state",
    name: "Western Sweden",
    population: 1_400_000,
    gdp: 95_000,
    houseDistricts: 59,
    stateSenateSeats: 28,
    region: "West",
    votingSystem: "rcv",
  },
  {
    _id: "SE_SKA",
    countryId: "SE",
    regionType: "state",
    name: "Skåne",
    population: 1_000_000,
    gdp: 60_000,
    houseDistricts: 42,
    stateSenateSeats: 20,
    region: "South",
    votingSystem: "rcv",
  },
  {
    _id: "SE_EAS",
    countryId: "SE",
    regionType: "state",
    name: "Eastern Sweden",
    population: 900_000,
    gdp: 50_000,
    houseDistricts: 38,
    stateSenateSeats: 18,
    region: "East",
    votingSystem: "rcv",
  },
  {
    _id: "SE_SML",
    countryId: "SE",
    regionType: "state",
    name: "Småland",
    population: 900_000,
    gdp: 45_000,
    houseDistricts: 38,
    stateSenateSeats: 18,
    region: "Southeast",
    votingSystem: "rcv",
  },
  {
    _id: "SE_VML",
    countryId: "SE",
    regionType: "state",
    name: "Bergslagen",
    population: 800_000,
    gdp: 40_000,
    houseDistricts: 34,
    stateSenateSeats: 16,
    region: "Central",
    votingSystem: "rcv",
  },
  {
    _id: "SE_NOR",
    countryId: "SE",
    regionType: "state",
    name: "Norrland",
    population: 1_200_000,
    gdp: 55_000,
    houseDistricts: 50,
    stateSenateSeats: 24,
    region: "North",
    votingSystem: "rcv",
  },
  {
    _id: "SE_UPP",
    countryId: "SE",
    regionType: "state",
    name: "Uppland & Dalarna",
    population: 600_000,
    gdp: 25_000,
    houseDistricts: 25,
    stateSenateSeats: 12,
    region: "North-Central",
    votingSystem: "rcv",
  },
];

export default seRegions;
