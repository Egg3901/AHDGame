import type { State } from "@/lib/db/types";

/**
 * UK regions, 1991 Census population + 1991 nominal regional GVA (GBP millions).
 *
 * Population: 1991 Census of England + 1991 NI Census + 1991 GROS Scotland.
 * GDP: ONS Workplace-Based Gross Value Added 1991 (approximate; ONS revised
 * the regional series in 2004 and 2010 — figures here are pre-revision).
 * House district counts follow the 1983 GE constituency boundaries (650 total
 * across 12 game regions) — the ones in force in January 1991, when this world
 * opens.
 * stateSenateSeats follow the modern Regional Council configuration —
 * regional councils didn't exist in 1992 (anachronistic compromise).
 */
/**
 * ⚠️ House districts total 650, matching the January 1991 Commons exactly.
 *
 * They summed to 665 before, which would have elected 665 members into the
 * chamber. Scotland (72), Wales (38) and Northern Ireland (17) were already
 * correct, so the entire excess sat in England.
 *
 * ⚠️ THIS WAS 651, WHICH IS THE WRONG PARLIAMENT. 651 is the chamber the 1992
 * boundary review produced, and a `1991-default` world opens in January 1991 —
 * fifteen months before that review took effect and before the April 1992
 * election that first filled it. The 1983 boundaries in force at the start
 * give 650, England 523. `UK_COMMONS_SEATS_1991` mirrors these numbers and
 * `UK_COMMONS_1987` seats them, so the chamber config, the districts, the
 * roster and the election allocator now agree region by region.
 *
 * ⚠️ The English total of 523 is exact; the split of it across the nine English
 * regions is NOT the historical per-region constituency count, which would need
 * the 1983 boundary review to establish. It descends from the previous modelled
 * split, less one seat in London — the most over-represented English region on
 * this file's own 1991 populations (84,012 per seat against East Midlands'
 * 98,341), and the one region whose seat count really did fall across this
 * period (92 in 1979, 74 by 1999). Anyone holding the real 1983 review data
 * should replace these nine numbers; the total, and the three non-English
 * figures, are already right.
 */
export const ukRegions1991: State[] = [
  {
    _id: "LON",
    countryId: "UK",
    regionType: "constituency",
    parentRegionId: "ENG",
    name: "London",
    population: 6_889_000,
    gdp: 80_000,
    houseDistricts: 81,
    stateSenateSeats: 32,
    region: "London",
    votingSystem: "fptp",
  },
  {
    _id: "SEE",
    countryId: "UK",
    regionType: "constituency",
    parentRegionId: "ENG",
    name: "South East England",
    population: 7_550_000,
    gdp: 65_000,
    houseDistricts: 89,
    stateSenateSeats: 67,
    region: "South East",
    votingSystem: "fptp",
  },
  {
    _id: "SWE",
    countryId: "UK",
    regionType: "constituency",
    parentRegionId: "ENG",
    name: "South West England",
    population: 4_682_000,
    gdp: 32_000,
    houseDistricts: 50,
    stateSenateSeats: 39,
    region: "South West",
    votingSystem: "fptp",
  },
  {
    _id: "EAE",
    countryId: "UK",
    regionType: "constituency",
    parentRegionId: "ENG",
    name: "East of England",
    population: 5_106_000,
    gdp: 39_000,
    houseDistricts: 53,
    stateSenateSeats: 39,
    region: "East",
    votingSystem: "fptp",
  },
  {
    _id: "EMI",
    countryId: "UK",
    regionType: "constituency",
    parentRegionId: "ENG",
    name: "East Midlands",
    population: 4_032_000,
    gdp: 28_000,
    houseDistricts: 41,
    stateSenateSeats: 39,
    region: "East Midlands",
    votingSystem: "fptp",
  },
  {
    _id: "WMI",
    countryId: "UK",
    regionType: "constituency",
    parentRegionId: "ENG",
    name: "West Midlands",
    population: 5_265_000,
    gdp: 36_000,
    houseDistricts: 56,
    stateSenateSeats: 18,
    region: "West Midlands",
    votingSystem: "fptp",
  },
  {
    _id: "YHU",
    countryId: "UK",
    regionType: "constituency",
    parentRegionId: "ENG",
    name: "Yorkshire & the Humber",
    population: 4_983_000,
    gdp: 32_000,
    houseDistricts: 52,
    stateSenateSeats: 21,
    region: "Yorkshire & the Humber",
    votingSystem: "fptp",
  },
  {
    _id: "NWE",
    countryId: "UK",
    regionType: "constituency",
    parentRegionId: "ENG",
    name: "North West England",
    population: 6_834_000,
    gdp: 44_000,
    houseDistricts: 72,
    stateSenateSeats: 27,
    region: "North West",
    votingSystem: "fptp",
  },
  {
    _id: "NEE",
    countryId: "UK",
    regionType: "constituency",
    parentRegionId: "ENG",
    name: "North East England",
    population: 2_603_000,
    gdp: 16_500,
    houseDistricts: 29,
    stateSenateSeats: 17,
    region: "North East",
    votingSystem: "fptp",
  },
  {
    _id: "SCO",
    countryId: "UK",
    regionType: "constituency",
    parentRegionId: "GBN",
    name: "Scotland",
    population: 5_102_000,
    gdp: 36_000,
    houseDistricts: 72,
    stateSenateSeats: 129,
    region: "Scotland",
    votingSystem: "fptp",
  },
  {
    _id: "WAL",
    countryId: "UK",
    regionType: "constituency",
    parentRegionId: "GBN",
    name: "Wales",
    population: 2_891_000,
    gdp: 17_000,
    houseDistricts: 38,
    stateSenateSeats: 60,
    region: "Wales",
    votingSystem: "fptp",
  },
  {
    _id: "NIR",
    countryId: "UK",
    regionType: "constituency",
    parentRegionId: "GBN",
    name: "Northern Ireland",
    population: 1_577_000,
    gdp: 7_500,
    houseDistricts: 17,
    stateSenateSeats: 90,
    region: "Northern Ireland",
    votingSystem: "fptp",
  },
];
