import type { State } from "@/lib/db/types";

/**
 * Italy regions — 1953-era values (First Republic / Christian Democracy).
 *
 * SEED INDEPENDENCE — DO NOT DERIVE FROM ANOTHER ERA.
 * Values authored for 1953 directly. Italy 1953: pop ≈ 47.5M (1951 census);
 * GDP ≈ $17B USD-equivalent (₤10.6T at Bretton Woods 625 ITL/USD — refs #3498).
 * De Gasperi's DC dominant; the "Miracolo Economico" is just beginning; the 1953
 * election was fought on the controversial "legge truffa".
 *
 * - `population` — 1951 census estimates.
 * - `gdp` — regional GDP in **USD millions** (USD-anchored like US/DE, refs #3498).
 * - `houseDistricts` — Chamber of Deputies seats (1953; sum = 590, the
 *   Camera size in force 1948–1963 before the 630-seat reform).
 * - `stateSenateSeats` — Senate of the Republic seats.
 * - `votingSystem` — rcv (proportional/two-round approximation).
 */
export const itRegions1953: State[] = [
  {
    _id: "IT_NW",
    countryId: "IT",
    regionType: "state",
    name: "Northwest",
    population: 11_500_000,
    gdp: 5_609,
    houseDistricts: 167,
    stateSenateSeats: 79,
    region: "North",
    votingSystem: "rcv",
  },
  {
    _id: "IT_NE",
    countryId: "IT",
    regionType: "state",
    name: "Northeast",
    population: 8_500_000,
    gdp: 3_505,
    houseDistricts: 104,
    stateSenateSeats: 49,
    region: "North",
    votingSystem: "rcv",
  },
  {
    _id: "IT_TUS",
    countryId: "IT",
    regionType: "state",
    name: "Central Italy",
    population: 6_200_000,
    gdp: 2_278,
    houseDistricts: 76,
    stateSenateSeats: 36,
    region: "Center",
    votingSystem: "rcv",
  },
  {
    _id: "IT_LAZ",
    countryId: "IT",
    regionType: "state",
    name: "Lazio",
    population: 4_000_000,
    gdp: 1_928,
    houseDistricts: 50,
    stateSenateSeats: 24,
    region: "Center",
    votingSystem: "rcv",
  },
  {
    _id: "IT_CAM",
    countryId: "IT",
    regionType: "state",
    name: "Campania",
    population: 5_000_000,
    gdp: 1_227,
    houseDistricts: 58,
    stateSenateSeats: 28,
    region: "South",
    votingSystem: "rcv",
  },
  {
    _id: "IT_SUD",
    countryId: "IT",
    regionType: "state",
    name: "Southern Italy",
    population: 5_800_000,
    gdp: 1_227,
    houseDistricts: 67,
    stateSenateSeats: 32,
    region: "South",
    votingSystem: "rcv",
  },
  {
    _id: "IT_SIC",
    countryId: "IT",
    regionType: "state",
    name: "Sicily",
    population: 4_500_000,
    gdp: 964,
    houseDistricts: 53,
    stateSenateSeats: 25,
    region: "Islands",
    votingSystem: "rcv",
  },
  {
    _id: "IT_SAR",
    countryId: "IT",
    regionType: "state",
    name: "Sardinia",
    population: 1_300_000,
    gdp: 263,
    houseDistricts: 15,
    stateSenateSeats: 7,
    region: "Islands",
    votingSystem: "rcv",
  },
];

export default itRegions1953;
