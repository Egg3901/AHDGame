import type { State } from "@/lib/db/types";
/**
 * Czechoslovakia regions (1979; Husák "normalization") — four regions: Prague
 * plus the three historic lands (Bohemia and Moravia — together the Czech
 * Socialist Republic — and the Slovak Socialist Republic, federated since
 * 1969). pop ≈ 15.3M; gdp in millions of koruna.
 *
 * houseDistricts = Chamber of the People seats, apportioned by population
 * (sum = 200, matching the country config's lowerChamber seats).
 */
export const csRegions: State[] = [
  {
    _id: "CS_PRG",
    countryId: "CS",
    regionType: "state",
    name: "Prague",
    population: 1_200_000,
    gdp: 130_000,
    houseDistricts: 16,
    stateSenateSeats: 0,
    region: "Prague",
    votingSystem: "fptp",
  },
  {
    _id: "CS_BOH",
    countryId: "CS",
    regionType: "state",
    name: "Bohemia",
    population: 5_200_000,
    gdp: 290_000,
    houseDistricts: 68,
    stateSenateSeats: 0,
    region: "Bohemia",
    votingSystem: "fptp",
  },
  {
    _id: "CS_MOR",
    countryId: "CS",
    regionType: "state",
    name: "Moravia",
    population: 3_900_000,
    gdp: 230_000,
    houseDistricts: 51,
    stateSenateSeats: 0,
    region: "Moravia",
    votingSystem: "fptp",
  },
  {
    _id: "CS_SVK",
    countryId: "CS",
    regionType: "state",
    name: "Slovakia",
    population: 5_000_000,
    gdp: 250_000,
    houseDistricts: 65,
    stateSenateSeats: 0,
    region: "Slovakia",
    votingSystem: "fptp",
  },
];
export default csRegions;
