/**
 * SEED INDEPENDENCE — DO NOT DERIVE FROM ANOTHER ERA.
 * Each era seed is self-contained. This file MUST NOT import and transform
 * another era's region data. All values are authored for 1953 directly.
 * Type-only imports are allowed.
 *
 * PRC macro-regions for the 1953-default preset (first Five-Year Plan begins;
 * 1953 census — first PRC census; Korean War armistice; Stalin dies).
 * The 7 game macro-regions are structurally stable; era-specific values are
 * 1953-census population (582M total), ~1953 regional GDP in **USD millions**
 * (USD-anchored like US/DE — refs #3498; ¥CNY 82B at official ~2.46 CNY/USD ≈
 * $33.3B), and an approximate seat distribution from the 1954 First NPC
 * (1,226 deputies).
 *
 * NOTE: Tibet (XZ) and Xinjiang (XJ) are included in the XN/XB macro-regions;
 * elections in 1953 China were a top-down process — NPC seats here model the
 * formal allocation, not competitive elections.
 */
import type { State } from "@/lib/db/types";

export const cnRegions1953: State[] = [
  {
    _id: "DB",
    countryId: "CN",
    regionType: "state",
    name: "Dongbei (Northeast)",
    population: 42_000_000,
    gdp: 7_619,
    houseDistricts: 88,
    stateSenateSeats: 270,
    region: "Northeast",
    votingSystem: "fptp",
  },
  {
    _id: "HB",
    countryId: "CN",
    regionType: "state",
    name: "Huabei (North China)",
    population: 61_000_000,
    gdp: 4_762,
    houseDistricts: 129,
    stateSenateSeats: 395,
    region: "North",
    votingSystem: "fptp",
  },
  {
    _id: "HD",
    countryId: "CN",
    regionType: "state",
    name: "Huadong (East China)",
    population: 180_000_000,
    gdp: 10_476,
    houseDistricts: 379,
    stateSenateSeats: 1_164,
    region: "East",
    votingSystem: "fptp",
  },
  {
    _id: "HZ",
    countryId: "CN",
    regionType: "state",
    name: "Huazhong (Central China)",
    population: 105_000_000,
    gdp: 3_333,
    houseDistricts: 215,
    stateSenateSeats: 678,
    region: "Central",
    votingSystem: "fptp",
  },
  {
    _id: "HN",
    countryId: "CN",
    regionType: "state",
    name: "Huanan (South China)",
    population: 56_000_000,
    gdp: 2_857,
    houseDistricts: 118,
    stateSenateSeats: 362,
    region: "South",
    votingSystem: "fptp",
  },
  {
    _id: "XN",
    countryId: "CN",
    regionType: "state",
    name: "Xinan (Southwest)",
    population: 104_000_000,
    gdp: 2_619,
    houseDistricts: 219,
    stateSenateSeats: 673,
    region: "Southwest",
    votingSystem: "fptp",
  },
  {
    _id: "XB",
    countryId: "CN",
    regionType: "state",
    name: "Xibei (Northwest)",
    population: 37_000_000,
    gdp: 1_667,
    houseDistricts: 78,
    stateSenateSeats: 239,
    region: "Northwest",
    votingSystem: "fptp",
  },
];

export default cnRegions1953;
