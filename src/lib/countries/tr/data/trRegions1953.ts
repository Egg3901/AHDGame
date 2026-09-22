import type { State } from "@/lib/db/types";

/**
 * Turkey regions — 1953 era.
 * Anchored on 1950 Census (population 20.9M; growing to ≈22.5M by 1953) under
 * Menderes's Democrat Party government. Grand National Assembly (TBMM):
 *   487 seats → houseDistricts (1954 election allocation).
 *   stateSenateSeats: nominal regional weights (senate was unicameral in 1953;
 *   Senate introduced only in 1961 constitution).
 * GDP in millions of TRY (Turkish lira at pre-devaluation parity; total ≈ 6,800B TRY).
 * Cold War: Turkey in NATO since 1952; Korean War veterans.
 * SEED INDEPENDENCE — no imports from any other era file.
 */
export const trRegions1953: State[] = [
  {
    _id: "TR_IST",
    countryId: "TR",
    regionType: "state",
    name: "Marmara",
    population: 3_000_000,
    gdp: 1_700_000,
    houseDistricts: 65,
    stateSenateSeats: 25,
    region: "Marmara",
    votingSystem: "rcv",
  },
  {
    _id: "TR_ANK",
    countryId: "TR",
    regionType: "state",
    name: "Ankara",
    population: 2_800_000,
    gdp: 950_000,
    houseDistricts: 56,
    stateSenateSeats: 22,
    region: "Central Anatolia",
    votingSystem: "rcv",
  },
  {
    _id: "TR_IZM",
    countryId: "TR",
    regionType: "state",
    name: "Aegean",
    population: 2_500_000,
    gdp: 850_000,
    houseDistricts: 54,
    stateSenateSeats: 21,
    region: "Aegean",
    votingSystem: "rcv",
  },
  {
    _id: "TR_MED",
    countryId: "TR",
    regionType: "state",
    name: "Mediterranean",
    population: 2_800_000,
    gdp: 700_000,
    houseDistricts: 60,
    stateSenateSeats: 23,
    region: "Mediterranean",
    votingSystem: "rcv",
  },
  {
    _id: "TR_BLA",
    countryId: "TR",
    regionType: "state",
    name: "Black Sea",
    population: 3_000_000,
    gdp: 550_000,
    houseDistricts: 65,
    stateSenateSeats: 25,
    region: "Black Sea",
    votingSystem: "rcv",
  },
  {
    _id: "TR_ESA",
    countryId: "TR",
    regionType: "state",
    name: "Eastern Anatolia",
    population: 2_500_000,
    gdp: 450_000,
    houseDistricts: 53,
    stateSenateSeats: 20,
    region: "Eastern Anatolia",
    votingSystem: "rcv",
  },
  {
    _id: "TR_SEA",
    countryId: "TR",
    regionType: "state",
    name: "Southeastern Anatolia",
    population: 2_500_000,
    gdp: 500_000,
    houseDistricts: 53,
    stateSenateSeats: 20,
    region: "Southeastern Anatolia",
    votingSystem: "rcv",
  },
  {
    _id: "TR_CEN",
    countryId: "TR",
    regionType: "state",
    name: "Central Anatolia",
    population: 3_400_000,
    gdp: 1_100_000,
    houseDistricts: 81,
    stateSenateSeats: 28,
    region: "Central Anatolia",
    votingSystem: "rcv",
  },
];

export default trRegions1953;
