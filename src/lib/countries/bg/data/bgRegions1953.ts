import type { State } from "@/lib/db/types";

/** Bulgaria 1953 — Chervenkov Stalinist era. Pop ~7.3M; GDP in millions of leva.
 *  Very agricultural; tobacco, wine, and roses the main exports. Valko Chervenkov
 *  ("Little Stalin") runs one of the most repressive regimes in the Bloc.
 *
 *  Same five regions as 1979 (Sofia / Danubian Plain / Black Sea Coast /
 *  Thrace / Southwest). houseDistricts sums to the same 400-seat National
 *  Assembly as the base config. */
export const bgRegions1953: State[] = [
  {
    _id: "BG_SOF",
    countryId: "BG",
    regionType: "state",
    name: "Sofia",
    population: 950_000,
    gdp: 8_000,
    houseDistricts: 52,
    stateSenateSeats: 0,
    region: "Sofia",
    votingSystem: "fptp",
  },
  {
    _id: "BG_NOR",
    countryId: "BG",
    regionType: "state",
    name: "Northern Bulgaria",
    population: 2_600_000,
    gdp: 10_000,
    houseDistricts: 143,
    stateSenateSeats: 0,
    region: "Danubian Plain",
    votingSystem: "fptp",
  },
  {
    _id: "BG_COA",
    countryId: "BG",
    regionType: "state",
    name: "Black Sea Coast",
    population: 1_000_000,
    gdp: 4_000,
    houseDistricts: 55,
    stateSenateSeats: 0,
    region: "Black Sea",
    votingSystem: "fptp",
  },
  {
    _id: "BG_THR",
    countryId: "BG",
    regionType: "state",
    name: "Thrace",
    population: 2_150_000,
    gdp: 6_000,
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
    population: 600_000,
    gdp: 2_000,
    houseDistricts: 32,
    stateSenateSeats: 0,
    region: "Southwest",
    votingSystem: "fptp",
  },
];
export default bgRegions1953;
