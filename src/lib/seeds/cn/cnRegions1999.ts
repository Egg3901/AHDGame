/**
 * SEED INDEPENDENCE — DO NOT DERIVE FROM ANOTHER ERA.
 * Each era seed is self-contained. This file MUST NOT import and transform
 * another era's region data. All values are authored for 1999 directly.
 * Type-only imports are allowed.
 *
 * China macro-regions for the 1999-default preset (Jiang Zemin era, the SOE-
 * reform / pre-WTO-accession boom, 9th NPC). The 7 macro-regions are
 * structurally stable; the era-specific values are late-1990s population and
 * ~1999 regional GDP (CNY millions). `houseDistricts`/`stateSenateSeats` are
 * structural.
 */
import type { State } from "@/lib/db/types";

export const cnRegions1999: State[] = [
  {
    _id: "DB",
    countryId: "CN",
    regionType: "province",
    name: "Dongbei",
    population: 106_000_000,
    gdp: 900_000,
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
    population: 130_000_000,
    gdp: 1_200_000,
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
    population: 360_000_000,
    gdp: 3_200_000,
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
    population: 165_000_000,
    gdp: 1_100_000,
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
    population: 130_000_000,
    gdp: 1_250_000,
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
    population: 200_000_000,
    gdp: 850_000,
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
    population: 135_000_000,
    gdp: 500_000,
    houseDistricts: 320,
    stateSenateSeats: 232,
    region: "Xibei",
    votingSystem: "fptp",
  },
];

export default cnRegions1999;
