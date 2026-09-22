import type { State } from "@/lib/db/types";

/** Hungary 1953 — Rákosi era; pop ~9.5M; GDP in millions of forint.
 *  Stalinist forced industrialization; Sztálinváros (Dunaújváros) steelworks; June 1953
 *  Nagy briefly becomes PM under Soviet pressure. Brutal AVH secret police.
 *
 *  Same six regions as 1979 (Budapest / Pest / Western & Southern Transdanubia /
 *  Northern Hungary / Great Plain). Population ~9.5M (Hungarian Central
 *  Statistical Office / UN early 1950s). houseDistricts sums to the same
 *  352-seat National Assembly as the base config. */
export const huRegions1953: State[] = [
  {
    _id: "HU_BUD",
    countryId: "HU",
    regionType: "state",
    name: "Budapest",
    population: 1_650_000,
    gdp: 12_000,
    houseDistricts: 61,
    stateSenateSeats: 4,
    region: "Budapest",
    votingSystem: "fptp",
  },
  {
    _id: "HU_PES",
    countryId: "HU",
    regionType: "state",
    name: "Pest",
    population: 850_000,
    gdp: 3_000,
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
    population: 1_850_000,
    gdp: 9_000,
    houseDistricts: 69,
    stateSenateSeats: 4,
    region: "Transdanubia",
    votingSystem: "fptp",
  },
  {
    _id: "HU_TRS",
    countryId: "HU",
    regionType: "state",
    name: "Southern Transdanubia",
    population: 950_000,
    gdp: 4_000,
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
    population: 1_250_000,
    gdp: 7_000,
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
    population: 2_950_000,
    gdp: 8_000,
    houseDistricts: 109,
    stateSenateSeats: 6,
    region: "Great Plain",
    votingSystem: "fptp",
  },
];
export default huRegions1953;
