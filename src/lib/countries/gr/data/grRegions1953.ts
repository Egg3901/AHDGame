import type { State } from "@/lib/db/types";

/** Greece 1953 — post-civil-war kingdom under Papagos. Pop ~7.6M (1951
 *  census); GDP in millions of drachmae (pre-1954 revaluation scale kept
 *  game-abstract). Reconstruction on American aid, mass emigration beginning,
 *  Athens swelling with internal migrants.
 *
 *  Same six macro-regions as 1979. houseDistricts sums to the same 300-seat
 *  Vouli as the base config. */
export const grRegions1953: State[] = [
  {
    _id: "GR_ATT",
    countryId: "GR",
    regionType: "state",
    name: "Attica",
    population: 1_500_000,
    gdp: 18_000,
    houseDistricts: 59,
    stateSenateSeats: 0,
    region: "Attica",
    votingSystem: "rcv",
  },
  {
    _id: "GR_MAC",
    countryId: "GR",
    regionType: "state",
    name: "Macedonia & Thrace",
    population: 2_000_000,
    gdp: 12_000,
    houseDistricts: 79,
    stateSenateSeats: 0,
    region: "Macedonia",
    votingSystem: "rcv",
  },
  {
    _id: "GR_THE",
    countryId: "GR",
    regionType: "state",
    name: "Thessaly",
    population: 650_000,
    gdp: 4_000,
    houseDistricts: 26,
    stateSenateSeats: 0,
    region: "Thessaly",
    votingSystem: "rcv",
  },
  {
    _id: "GR_EPC",
    countryId: "GR",
    regionType: "state",
    name: "Epirus & Central Greece",
    population: 1_050_000,
    gdp: 5_000,
    houseDistricts: 41,
    stateSenateSeats: 0,
    region: "Central",
    votingSystem: "rcv",
  },
  {
    _id: "GR_PEL",
    countryId: "GR",
    regionType: "state",
    name: "Peloponnese",
    population: 1_200_000,
    gdp: 6_000,
    houseDistricts: 47,
    stateSenateSeats: 0,
    region: "Peloponnese",
    votingSystem: "rcv",
  },
  {
    _id: "GR_ISL",
    countryId: "GR",
    regionType: "state",
    name: "Islands & Crete",
    population: 1_200_000,
    gdp: 5_000,
    houseDistricts: 48,
    stateSenateSeats: 0,
    region: "Islands",
    votingSystem: "rcv",
  },
];
export default grRegions1953;
