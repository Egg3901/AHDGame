import type { State } from "@/lib/db/types";

/** Hungary regions (2027) — Third-Republic democracy; pop ~9.6M (KSH 2024
 *  county groups); GDP in millions of forint (2024 nominal ~79.5T Ft).
 *
 *  Same six macro-region ids as 1953/1979 (Budapest / Pest / Western incl.
 *  Central Transdanubia / Southern Transdanubia / Northern Hungary /
 *  Great Plain), so the Layer-1 census keys keep resolving.
 *  houseDistricts = Orszaggyules seats apportioned by population, largest
 *  remainder (sum = 199, the post-2014 unicameral total); stateSenateSeats = 0
 *  (no upper chamber since the Presidential Council was abolished in 1989).
 *  The 106 single-member + 93 list split is election logic, not regional data.
 */
export const huRegions2027: State[] = [
  {
    _id: "HU_BUD",
    countryId: "HU",
    regionType: "state",
    name: "Budapest",
    population: 1_682_000,
    gdp: 29_400_000,
    houseDistricts: 35,
    stateSenateSeats: 0,
    region: "Budapest",
    votingSystem: "fptp",
  },
  {
    _id: "HU_PES",
    countryId: "HU",
    regionType: "state",
    name: "Pest",
    population: 1_333_000,
    gdp: 8_700_000,
    houseDistricts: 27,
    stateSenateSeats: 0,
    region: "Pest",
    votingSystem: "fptp",
  },
  {
    _id: "HU_TRW",
    countryId: "HU",
    regionType: "state",
    name: "Western Transdanubia",
    population: 2_059_000,
    gdp: 15_900_000,
    houseDistricts: 42,
    stateSenateSeats: 0,
    region: "Transdanubia",
    votingSystem: "fptp",
  },
  {
    _id: "HU_TRS",
    countryId: "HU",
    regionType: "state",
    name: "Southern Transdanubia",
    population: 862_000,
    gdp: 4_800_000,
    houseDistricts: 18,
    stateSenateSeats: 0,
    region: "Transdanubia",
    votingSystem: "fptp",
  },
  {
    _id: "HU_NOR",
    countryId: "HU",
    regionType: "state",
    name: "Northern Hungary",
    population: 1_095_000,
    gdp: 6_800_000,
    houseDistricts: 23,
    stateSenateSeats: 0,
    region: "Northern Hungary",
    votingSystem: "fptp",
  },
  {
    _id: "HU_ALF",
    countryId: "HU",
    regionType: "state",
    name: "Great Plain",
    population: 2_618_000,
    gdp: 13_900_000,
    houseDistricts: 54,
    stateSenateSeats: 0,
    region: "Great Plain",
    votingSystem: "fptp",
  },
];
export default huRegions2027;
