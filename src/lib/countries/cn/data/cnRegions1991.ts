import type { State } from "@/lib/db/types";
import { allocatePopulationTotal } from "@/lib/seeds/rules/populationAllocation";
import { POPULATION_TOTALS_1991 } from "@/lib/seeds/reference/populationTotals1991";

/**
 * China macro-regions, 1990 Census + 1991 nominal regional GDP (CNY).
 *
 * Population shares: existing approximate 1990-era model. Counts are normalized
 *   to the NBS 1991 year-end mainland total; see populationTotals1991.ts.
 * GDP: 1991 nominal regional GDP, in millions of CNY.
 *   Source: NBS Provincial Statistical Yearbooks 1991 series, aggregated to
 *   the 7-region game scheme.
 * NPC seat allocation: 7th NPC seat counts (1988-1993), 2,978 total. Game's
 *   2,980 model retains the regional weights; minor adjustments to round.
 * CPPCC seat allocation: 7th CPPCC composition.
 */
const cnRegionPopulationWeights1991: State[] = [
  {
    _id: "DB",
    countryId: "CN",
    regionType: "province",
    name: "Dongbei",
    population: 99_840_000,
    gdp: 220_000,
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
    population: 120_000_000,
    gdp: 350_000,
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
    population: 312_000_000,
    gdp: 680_000,
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
    population: 152_000_000,
    gdp: 260_000,
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
    population: 113_000_000,
    gdp: 250_000,
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
    population: 192_000_000,
    gdp: 220_000,
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
    gdp: 180_000,
    houseDistricts: 320,
    stateSenateSeats: 232,
    region: "Xibei",
    votingSystem: "fptp",
  },
];

/** Regional counts are estimates normalized to the dated national anchor, not census observations. */
export const cnRegions1991 = allocatePopulationTotal(
  cnRegionPopulationWeights1991,
  POPULATION_TOTALS_1991.CN.population
);
