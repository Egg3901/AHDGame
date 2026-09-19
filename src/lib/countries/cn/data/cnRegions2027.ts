/**
 * SEED INDEPENDENCE - DO NOT DERIVE FROM ANOTHER ERA.
 * Each era seed is self-contained. This file MUST NOT import and transform
 * another era's region data. All values are authored for 2027 directly.
 * Type-only imports are allowed.
 *
 * China macro-regions for the 2027-default preset (post-20th Party Congress
 * continuity; 14th NPC term 2023 to 2028).
 *
 * Base: the 2023 bundle values, projected forward 2023 to 2027.
 * Projection assumptions (documented, not computed):
 * - National population peaked in 2022 and falls about 2 million per year
 *   through 2026 (NBS annual communiques). Game total falls 0.3 pct.
 *   Dongbei falls fastest (2.0 pct) continuing the 2020 census pattern
 *   where Liaoning, Heilongjiang, and Jilin lost 11 million over the
 *   decade; Huanan edges up on Greater Bay Area in-migration.
 *   Source: https://www.stats.gov.cn/english/ (NBS communiques, census data)
 * - Regional GDP is nominal CNY millions, roughly 12 pct above the 2023
 *   bundle (national nominal growth 2023 to 2026). Rounded.
 * - `houseDistricts` (NPC, 2980 total) and `stateSenateSeats` (CPPCC, 2169
 *   total) are structural and held constant across eras.
 */
import type { State } from "@/lib/db/types";

export const cnRegions2027: State[] = [
  {
    _id: "DB",
    countryId: "CN",
    regionType: "province",
    name: "Dongbei",
    population: 97_500_000,
    gdp: 6_100_000,
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
    population: 134_500_000,
    gdp: 20_200_000,
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
    population: 385_500_000,
    gdp: 47_000_000,
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
    population: 164_000_000,
    gdp: 17_900_000,
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
    population: 132_500_000,
    gdp: 20_200_000,
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
    population: 194_000_000,
    gdp: 15_700_000,
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
    population: 130_000_000,
    gdp: 9_500_000,
    houseDistricts: 320,
    stateSenateSeats: 232,
    region: "Xibei",
    votingSystem: "fptp",
  },
];

export default cnRegions2027;
