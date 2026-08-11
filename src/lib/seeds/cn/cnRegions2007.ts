/**
 * SEED INDEPENDENCE — DO NOT DERIVE FROM ANOTHER ERA.
 * Each era seed is self-contained. This file MUST NOT import and transform
 * another era's region data. All values are authored for 2007 directly.
 * Type-only imports are allowed.
 *
 * China macro-regions for the 2007-default preset (Hu Jintao era, WTO-boom
 * China, 10th/11th NPC). The 7 macro-regions are structurally stable; the
 * era-specific values are 2007 population and ~2007 regional GDP (CNY millions —
 * the coastal export surge well advanced). `houseDistricts`/`stateSenateSeats`
 * are structural.
 */
import type { State } from "@/lib/db/types";

export const cnRegions2007: State[] = [
  {
    _id: "DB",
    countryId: "CN",
    regionType: "province",
    name: "Dongbei",
    population: 108_000_000,
    gdp: 2_400_000,
    houseDistricts: 238,
    stateSenateSeats: 175,
    region: "Dongbei",
    votingSystem: "fptp",
  },
  {
    _id: "HB",
    countryId: "CN",
    regionType: "province",
    name: "Huabei",
    population: 138_000_000,
    gdp: 3_800_000,
    houseDistricts: 323,
    stateSenateSeats: 235,
    region: "Huabei",
    votingSystem: "fptp",
  },
  {
    _id: "HD",
    countryId: "CN",
    regionType: "province",
    name: "Huadong",
    population: 385_000_000,
    gdp: 9_800_000,
    houseDistricts: 922,
    stateSenateSeats: 671,
    region: "Huadong",
    votingSystem: "fptp",
  },
  {
    _id: "HZ",
    countryId: "CN",
    regionType: "province",
    name: "Huazhong",
    population: 172_000_000,
    gdp: 3_000_000,
    houseDistricts: 395,
    stateSenateSeats: 287,
    region: "Huazhong",
    votingSystem: "fptp",
  },
  {
    _id: "HN",
    countryId: "CN",
    regionType: "province",
    name: "Huanan",
    population: 138_000_000,
    gdp: 3_800_000,
    houseDistricts: 316,
    stateSenateSeats: 230,
    region: "Huanan",
    votingSystem: "fptp",
  },
  {
    _id: "XN",
    countryId: "CN",
    regionType: "province",
    name: "Xinan",
    population: 205_000_000,
    gdp: 2_400_000,
    houseDistricts: 466,
    stateSenateSeats: 339,
    region: "Xinan",
    votingSystem: "fptp",
  },
  {
    _id: "XB",
    countryId: "CN",
    regionType: "province",
    name: "Xibei",
    population: 138_000_000,
    gdp: 1_800_000,
    houseDistricts: 320,
    stateSenateSeats: 232,
    region: "Xibei",
    votingSystem: "fptp",
  },
];

export default cnRegions2007;
