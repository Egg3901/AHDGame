import type { State } from "@/lib/db/types";

/**
 * Turkey regions as State-compatible documents (1979; Turkey is 1979-preset-only
 * here). Eight macro-regions group the 67 provinces of the era.
 * SEED INDEPENDENCE — ~1979 values (pop ≈ 43.5M; GDP ≈ ₺2,200B lira).
 *
 * houseDistricts = National Assembly seats (sum = 450). stateSenateSeats ≈ Senate
 * distribution (sum ≈ 184). gdp in millions of lira.
 */
export const trRegions: State[] = [
  {
    _id: "TR_IST",
    countryId: "TR",
    regionType: "state",
    name: "Marmara",
    population: 6_500_000,
    gdp: 500_000,
    houseDistricts: 67,
    stateSenateSeats: 30,
    region: "Marmara",
    votingSystem: "rcv",
  },
  {
    _id: "TR_ANK",
    countryId: "TR",
    regionType: "state",
    name: "Ankara",
    population: 4_500_000,
    gdp: 320_000,
    houseDistricts: 47,
    stateSenateSeats: 20,
    region: "Central Anatolia",
    votingSystem: "rcv",
  },
  {
    _id: "TR_IZM",
    countryId: "TR",
    regionType: "state",
    name: "Aegean",
    population: 5_000_000,
    gdp: 380_000,
    houseDistricts: 52,
    stateSenateSeats: 22,
    region: "Aegean",
    votingSystem: "rcv",
  },
  {
    _id: "TR_MED",
    countryId: "TR",
    regionType: "state",
    name: "Mediterranean",
    population: 5_500_000,
    gdp: 300_000,
    houseDistricts: 57,
    stateSenateSeats: 24,
    region: "Mediterranean",
    votingSystem: "rcv",
  },
  {
    _id: "TR_BLA",
    countryId: "TR",
    regionType: "state",
    name: "Black Sea",
    population: 6_500_000,
    gdp: 250_000,
    houseDistricts: 67,
    stateSenateSeats: 28,
    region: "Black Sea",
    votingSystem: "rcv",
  },
  {
    _id: "TR_ESA",
    countryId: "TR",
    regionType: "state",
    name: "Eastern Anatolia",
    population: 4_500_000,
    gdp: 130_000,
    houseDistricts: 47,
    stateSenateSeats: 20,
    region: "Eastern Anatolia",
    votingSystem: "rcv",
  },
  {
    _id: "TR_SEA",
    countryId: "TR",
    regionType: "state",
    name: "Southeastern Anatolia",
    population: 4_000_000,
    gdp: 120_000,
    houseDistricts: 41,
    stateSenateSeats: 18,
    region: "Southeastern Anatolia",
    votingSystem: "rcv",
  },
  {
    _id: "TR_CEN",
    countryId: "TR",
    regionType: "state",
    name: "Central Anatolia",
    population: 7_000_000,
    gdp: 200_000,
    houseDistricts: 72,
    stateSenateSeats: 22,
    region: "Central Anatolia",
    votingSystem: "rcv",
  },
];

export default trRegions;
