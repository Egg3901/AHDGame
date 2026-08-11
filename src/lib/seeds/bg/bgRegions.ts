import type { State } from "@/lib/db/types";
/**
 * Bulgaria regions (1979; Zhivkov era) — five regions: the Sofia capital
 * basin, the Danubian Plain north of the Balkan range, the Black Sea coast,
 * Thrace south of the range, and the southwestern highlands (Pirin/Struma).
 * pop ≈ 8.9M; gdp in millions of leva.
 *
 * houseDistricts = National Assembly seats, apportioned by population
 * (sum = 400, matching the country config's lowerChamber seats).
 */
export const bgRegions: State[] = [
  {
    _id: "BG_SOF",
    countryId: "BG",
    regionType: "state",
    name: "Sofia",
    population: 1_300_000,
    gdp: 90_000,
    houseDistricts: 58,
    stateSenateSeats: 0,
    region: "Sofia",
    votingSystem: "fptp",
  },
  {
    _id: "BG_NOR",
    countryId: "BG",
    regionType: "state",
    name: "Northern Bulgaria",
    population: 2_900_000,
    gdp: 120_000,
    houseDistricts: 130,
    stateSenateSeats: 0,
    region: "Danubian Plain",
    votingSystem: "fptp",
  },
  {
    _id: "BG_COA",
    countryId: "BG",
    regionType: "state",
    name: "Black Sea Coast",
    population: 1_300_000,
    gdp: 70_000,
    houseDistricts: 58,
    stateSenateSeats: 0,
    region: "Black Sea",
    votingSystem: "fptp",
  },
  {
    _id: "BG_THR",
    countryId: "BG",
    regionType: "state",
    name: "Thrace",
    population: 2_600_000,
    gdp: 100_000,
    houseDistricts: 118,
    stateSenateSeats: 0,
    region: "Thrace",
    votingSystem: "fptp",
  },
  {
    _id: "BG_SW",
    countryId: "BG",
    regionType: "state",
    name: "Southwestern Bulgaria",
    population: 800_000,
    gdp: 20_000,
    houseDistricts: 36,
    stateSenateSeats: 0,
    region: "Southwest",
    votingSystem: "fptp",
  },
];
export default bgRegions;
