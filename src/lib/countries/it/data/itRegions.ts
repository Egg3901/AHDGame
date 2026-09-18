import type { State } from "@/lib/db/types";

/**
 * Italy regions as State-compatible documents (1979; Italy is 1979-preset-only
 * here). Eight macro-regions group the 20 administrative regioni.
 * SEED INDEPENDENCE — ~1979 values (pop ≈ 56.4M; GDP ≈ ₤360,000B lira).
 *
 * houseDistricts = Chamber of Deputies seats (sum ≈ 630). stateSenateSeats ≈
 * Senate distribution. gdp in millions of lira.
 */
export const itRegions: State[] = [
  {
    _id: "IT_NW",
    countryId: "IT",
    regionType: "state",
    name: "Northwest",
    population: 15_000_000,
    gdp: 120_000_000,
    houseDistricts: 168,
    stateSenateSeats: 84,
    region: "North",
    votingSystem: "rcv",
  },
  {
    _id: "IT_NE",
    countryId: "IT",
    regionType: "state",
    name: "Northeast",
    population: 10_300_000,
    gdp: 70_000_000,
    houseDistricts: 116,
    stateSenateSeats: 58,
    region: "North",
    votingSystem: "rcv",
  },
  {
    _id: "IT_TUS",
    countryId: "IT",
    regionType: "state",
    name: "Central Italy",
    population: 5_800_000,
    gdp: 38_000_000,
    houseDistricts: 65,
    stateSenateSeats: 33,
    region: "Center",
    votingSystem: "rcv",
  },
  {
    _id: "IT_LAZ",
    countryId: "IT",
    regionType: "state",
    name: "Lazio",
    population: 5_000_000,
    gdp: 38_000_000,
    houseDistricts: 56,
    stateSenateSeats: 28,
    region: "Center",
    votingSystem: "rcv",
  },
  {
    _id: "IT_CAM",
    countryId: "IT",
    regionType: "state",
    name: "Campania",
    population: 5_400_000,
    gdp: 28_000_000,
    houseDistricts: 61,
    stateSenateSeats: 31,
    region: "South",
    votingSystem: "rcv",
  },
  {
    _id: "IT_SUD",
    countryId: "IT",
    regionType: "state",
    name: "Southern Italy",
    population: 7_900_000,
    gdp: 38_000_000,
    houseDistricts: 89,
    stateSenateSeats: 45,
    region: "South",
    votingSystem: "rcv",
  },
  {
    _id: "IT_SIC",
    countryId: "IT",
    regionType: "state",
    name: "Sicily",
    population: 4_900_000,
    gdp: 24_000_000,
    houseDistricts: 55,
    stateSenateSeats: 26,
    region: "Islands",
    votingSystem: "rcv",
  },
  {
    _id: "IT_SAR",
    countryId: "IT",
    regionType: "state",
    name: "Sardinia",
    population: 1_600_000,
    gdp: 8_000_000,
    houseDistricts: 20,
    stateSenateSeats: 10,
    region: "Islands",
    votingSystem: "rcv",
  },
];

export default itRegions;
