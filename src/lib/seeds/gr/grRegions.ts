import type { State } from "@/lib/db/types";

/** Greece regions (1979; Karamanlis republic, EEC accession signed) — six
 *  macro-regions grouping the historic geographic diamerismata. pop ≈ 9.5M;
 *  gdp in millions of drachmae.
 *
 *  houseDistricts = Vouli seats, apportioned by population (sum = 300,
 *  matching the country config's lowerChamber seats). */
export const grRegions: State[] = [
  {
    _id: "GR_ATT",
    countryId: "GR",
    regionType: "state",
    name: "Attica",
    population: 3_400_000,
    gdp: 600_000,
    houseDistricts: 107,
    stateSenateSeats: 0,
    region: "Attica",
    votingSystem: "rcv",
  },
  {
    _id: "GR_MAC",
    countryId: "GR",
    regionType: "state",
    name: "Macedonia & Thrace",
    population: 2_400_000,
    gdp: 330_000,
    houseDistricts: 76,
    stateSenateSeats: 0,
    region: "Macedonia",
    votingSystem: "rcv",
  },
  {
    _id: "GR_THE",
    countryId: "GR",
    regionType: "state",
    name: "Thessaly",
    population: 700_000,
    gdp: 90_000,
    houseDistricts: 22,
    stateSenateSeats: 0,
    region: "Thessaly",
    votingSystem: "rcv",
  },
  {
    _id: "GR_EPC",
    countryId: "GR",
    regionType: "state",
    name: "Epirus & Central Greece",
    population: 1_000_000,
    gdp: 130_000,
    houseDistricts: 32,
    stateSenateSeats: 0,
    region: "Central",
    votingSystem: "rcv",
  },
  {
    _id: "GR_PEL",
    countryId: "GR",
    regionType: "state",
    name: "Peloponnese",
    population: 1_000_000,
    gdp: 130_000,
    houseDistricts: 31,
    stateSenateSeats: 0,
    region: "Peloponnese",
    votingSystem: "rcv",
  },
  {
    _id: "GR_ISL",
    countryId: "GR",
    regionType: "state",
    name: "Islands & Crete",
    population: 1_000_000,
    gdp: 220_000,
    houseDistricts: 32,
    stateSenateSeats: 0,
    region: "Islands",
    votingSystem: "rcv",
  },
];
export default grRegions;
