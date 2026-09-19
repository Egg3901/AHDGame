import type { State } from "@/lib/db/types";
/**
 * Yugoslavia regions (1979; Tito's self-management socialism) — the eight
 * federal units of the 1974 constitution: six republics plus Serbia's two
 * autonomous provinces (Vojvodina, Kosovo), with Serbia proper as its own
 * region. pop ≈ 22.3M; gdp in millions of dinar.
 *
 * houseDistricts = Federal Chamber delegate seats, apportioned by population
 * (sum = 308, matching the country config's lowerChamber seats).
 */
export const yuRegions: State[] = [
  {
    _id: "YU_SLO",
    countryId: "YU",
    regionType: "state",
    name: "Slovenia",
    population: 1_900_000,
    gdp: 234_000,
    houseDistricts: 26,
    stateSenateSeats: 0,
    region: "Slovenia",
    votingSystem: "fptp",
  },
  {
    _id: "YU_CRO",
    countryId: "YU",
    regionType: "state",
    name: "Croatia",
    population: 4_600_000,
    gdp: 362_000,
    houseDistricts: 63,
    stateSenateSeats: 0,
    region: "Croatia",
    votingSystem: "fptp",
  },
  {
    _id: "YU_BIH",
    countryId: "YU",
    regionType: "state",
    name: "Bosnia & Herzegovina",
    population: 4_100_000,
    gdp: 178_000,
    houseDistricts: 57,
    stateSenateSeats: 0,
    region: "Bosnia",
    votingSystem: "fptp",
  },
  {
    _id: "YU_SRB",
    countryId: "YU",
    regionType: "state",
    name: "Serbia",
    population: 5_700_000,
    gdp: 341_000,
    houseDistricts: 79,
    stateSenateSeats: 0,
    region: "Serbia",
    votingSystem: "fptp",
  },
  {
    _id: "YU_VOJ",
    countryId: "YU",
    regionType: "state",
    name: "Vojvodina",
    population: 2_000_000,
    gdp: 149_000,
    houseDistricts: 28,
    stateSenateSeats: 0,
    region: "Vojvodina",
    votingSystem: "fptp",
  },
  {
    _id: "YU_KOS",
    countryId: "YU",
    regionType: "state",
    name: "Kosovo",
    population: 1_500_000,
    gdp: 28_000,
    houseDistricts: 21,
    stateSenateSeats: 0,
    region: "Kosovo",
    votingSystem: "fptp",
  },
  {
    _id: "YU_MNE",
    countryId: "YU",
    regionType: "state",
    name: "Montenegro",
    population: 600_000,
    gdp: 28_000,
    houseDistricts: 8,
    stateSenateSeats: 0,
    region: "Montenegro",
    votingSystem: "fptp",
  },
  {
    _id: "YU_MKD",
    countryId: "YU",
    regionType: "state",
    name: "Macedonia",
    population: 1_900_000,
    gdp: 100_000,
    houseDistricts: 26,
    stateSenateSeats: 0,
    region: "Macedonia",
    votingSystem: "fptp",
  },
];
export default yuRegions;
