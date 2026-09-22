import type { State } from "@/lib/db/types";

/** Romania 1953 — Gheorghiu-Dej era. Pop ~16.6M; GDP in millions of lei.
 *  Ploiești oil fields significant; Canal Dunăre–Marea Neagră under construction
 *  with forced labor; collectivization just beginning in earnest.
 *
 *  Same seven historic provinces as 1979. Population ~16.6M (UN / Romanian
 *  census series early 1950s). houseDistricts sums to the same 369-seat Grand
 *  National Assembly as the base config. */
export const roRegions1953: State[] = [
  {
    _id: "RO_BUC",
    countryId: "RO",
    regionType: "state",
    name: "Bucharest",
    population: 1_300_000,
    gdp: 7_000,
    houseDistricts: 29,
    stateSenateSeats: 0,
    region: "Bucharest",
    votingSystem: "fptp",
  },
  {
    _id: "RO_MUN",
    countryId: "RO",
    regionType: "state",
    name: "Muntenia",
    population: 3_700_000,
    gdp: 8_000,
    houseDistricts: 82,
    stateSenateSeats: 0,
    region: "Wallachia",
    votingSystem: "fptp",
  },
  {
    _id: "RO_OLT",
    countryId: "RO",
    regionType: "state",
    name: "Oltenia",
    population: 1_900_000,
    gdp: 4_000,
    houseDistricts: 42,
    stateSenateSeats: 0,
    region: "Wallachia",
    votingSystem: "fptp",
  },
  {
    _id: "RO_TRA",
    countryId: "RO",
    regionType: "state",
    name: "Transylvania",
    population: 3_500_000,
    gdp: 10_000,
    houseDistricts: 78,
    stateSenateSeats: 0,
    region: "Transylvania",
    votingSystem: "fptp",
  },
  {
    _id: "RO_VST",
    countryId: "RO",
    regionType: "state",
    name: "Banat & Crișana",
    population: 2_400_000,
    gdp: 6_000,
    houseDistricts: 53,
    stateSenateSeats: 0,
    region: "Transylvania",
    votingSystem: "fptp",
  },
  {
    _id: "RO_MOL",
    countryId: "RO",
    regionType: "state",
    name: "Moldavia",
    population: 3_200_000,
    gdp: 4_000,
    houseDistricts: 71,
    stateSenateSeats: 0,
    region: "Moldavia",
    votingSystem: "fptp",
  },
  {
    _id: "RO_DOB",
    countryId: "RO",
    regionType: "state",
    name: "Dobruja",
    population: 600_000,
    gdp: 1_000,
    houseDistricts: 14,
    stateSenateSeats: 0,
    region: "Dobruja",
    votingSystem: "fptp",
  },
];
export default roRegions1953;
