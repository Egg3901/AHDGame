import type { State } from "@/lib/db/types";

/**
 * Spain regions as State-compatible documents (1979; Spain is 1979-preset-only
 * here). Eight macro-regions group the autonomous communities then forming.
 * SEED INDEPENDENCE — ~1979 values (pop ≈ 37.0M; GDP ≈ ₧15,000B pesetas).
 *
 * houseDistricts = Congress of Deputies seats (sum = 350). stateSenateSeats ≈
 * Senate distribution (sum ≈ 208). gdp in millions of pesetas.
 */
export const esRegions: State[] = [
  {
    _id: "ES_MAD",
    countryId: "ES",
    regionType: "state",
    name: "Madrid",
    population: 4_700_000,
    gdp: 2_800_000,
    houseDistricts: 44,
    stateSenateSeats: 26,
    region: "Madrid",
    votingSystem: "rcv",
  },
  {
    _id: "ES_CAT",
    countryId: "ES",
    regionType: "state",
    name: "Catalonia",
    population: 5_900_000,
    gdp: 2_900_000,
    houseDistricts: 56,
    stateSenateSeats: 32,
    region: "Catalonia",
    votingSystem: "rcv",
  },
  {
    _id: "ES_AND",
    countryId: "ES",
    regionType: "state",
    name: "Andalusia",
    population: 6_400_000,
    gdp: 1_900_000,
    houseDistricts: 61,
    stateSenateSeats: 40,
    region: "South",
    votingSystem: "rcv",
  },
  {
    _id: "ES_VAL",
    countryId: "ES",
    regionType: "state",
    name: "Valencia & Murcia",
    population: 4_500_000,
    gdp: 1_800_000,
    houseDistricts: 43,
    stateSenateSeats: 24,
    region: "East",
    votingSystem: "rcv",
  },
  {
    _id: "ES_PVB",
    countryId: "ES",
    regionType: "state",
    name: "Basque Country & Navarre",
    population: 2_600_000,
    gdp: 1_300_000,
    houseDistricts: 25,
    stateSenateSeats: 16,
    region: "North",
    votingSystem: "rcv",
  },
  {
    _id: "ES_GAL",
    countryId: "ES",
    regionType: "state",
    name: "Galicia",
    population: 2_800_000,
    gdp: 800_000,
    houseDistricts: 27,
    stateSenateSeats: 18,
    region: "Northwest",
    votingSystem: "rcv",
  },
  {
    _id: "ES_NOR",
    countryId: "ES",
    regionType: "state",
    name: "Northern Spain",
    population: 3_300_000,
    gdp: 1_200_000,
    houseDistricts: 31,
    stateSenateSeats: 22,
    region: "North",
    votingSystem: "rcv",
  },
  {
    _id: "ES_CEN",
    countryId: "ES",
    regionType: "state",
    name: "Central Spain & Islands",
    population: 6_800_000,
    gdp: 2_300_000,
    houseDistricts: 63,
    stateSenateSeats: 30,
    region: "Center",
    votingSystem: "rcv",
  },
];

export default esRegions;
