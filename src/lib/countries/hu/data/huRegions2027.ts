import type { State } from "@/lib/db/types";

/** Hungary regions (2027) — Third-Republic democracy. The latest national
 *  anchors available for this future preset are the KSH 1 Jan 2026 population
 *  (9.488M) and revised 2025 annual GDP (HUF 87,045.554 billion).
 *  https://www.ksh.hu/stadat_files/nep/hu/nep0002.html
 *  https://www.ksh.hu/stadat_files/gdp/en/gdp0094.html
 *  These six regional figures are proportional estimates from the earlier
 *  authored distribution, reconciled exactly to those national anchors; they
 *  are not published KSH regional observations. GDP is millions of forint.
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
    population: 1_653_935,
    gdp: 32_190_431,
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
    population: 1_310_758,
    gdp: 9_525_739,
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
    population: 2_024_644,
    gdp: 17_409_111,
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
    population: 847_617,
    gdp: 5_255_581,
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
    population: 1_076_729,
    gdp: 7_445_406,
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
    population: 2_574_317,
    gdp: 15_219_286,
    houseDistricts: 54,
    stateSenateSeats: 0,
    region: "Great Plain",
    votingSystem: "fptp",
  },
];
export default huRegions2027;
