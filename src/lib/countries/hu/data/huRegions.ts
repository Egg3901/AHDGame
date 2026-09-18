import type { State } from "@/lib/db/types";

/** Hungary regions (1979) — six regions: Budapest, Pest county, Western and
 *  Southern Transdanubia, Northern Hungary, and the Great Plain (Alföld).
 *  DD_-style country-prefixed ids. pop ≈ 10.7M; gdp in millions of forint.
 *
 *  houseDistricts = National Assembly seats, apportioned by population
 *  (sum = 352, matching the country config's lowerChamber seats);
 *  stateSenateSeats = the 21-member Presidential Council, likewise split. */
export const huRegions: State[] = [
  {
    _id: "HU_BUD",
    countryId: "HU",
    regionType: "state",
    name: "Budapest",
    population: 2_060_000,
    gdp: 240_000,
    houseDistricts: 68,
    stateSenateSeats: 4,
    region: "Budapest",
    votingSystem: "fptp",
  },
  {
    _id: "HU_PES",
    countryId: "HU",
    regionType: "state",
    name: "Pest",
    population: 970_000,
    gdp: 55_000,
    houseDistricts: 32,
    stateSenateSeats: 2,
    region: "Pest",
    votingSystem: "fptp",
  },
  {
    _id: "HU_TRW",
    countryId: "HU",
    regionType: "state",
    name: "Western Transdanubia",
    population: 2_160_000,
    gdp: 165_000,
    houseDistricts: 71,
    stateSenateSeats: 4,
    region: "Transdanubia",
    votingSystem: "fptp",
  },
  {
    _id: "HU_TRS",
    countryId: "HU",
    regionType: "state",
    name: "Southern Transdanubia",
    population: 1_060_000,
    gdp: 70_000,
    houseDistricts: 35,
    stateSenateSeats: 2,
    region: "Transdanubia",
    votingSystem: "fptp",
  },
  {
    _id: "HU_NOR",
    countryId: "HU",
    regionType: "state",
    name: "Northern Hungary",
    population: 1_390_000,
    gdp: 110_000,
    houseDistricts: 46,
    stateSenateSeats: 3,
    region: "Northern Hungary",
    votingSystem: "fptp",
  },
  {
    _id: "HU_ALF",
    countryId: "HU",
    regionType: "state",
    name: "Great Plain",
    population: 3_060_000,
    gdp: 160_000,
    houseDistricts: 100,
    stateSenateSeats: 6,
    region: "Great Plain",
    votingSystem: "fptp",
  },
];
export default huRegions;
