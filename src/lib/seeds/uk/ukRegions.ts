import type { State } from "@/lib/db/types";

/**
 * UK regions as State-compatible documents.
 *
 * Uses the existing `states` collection — documents are differentiated from
 * US states by `countryId: "UK"` and `regionType`.
 *
 * Phase 1 uses the 12 UK electoral regions as the top-level playable units.
 * A future phase will expand to all 650 individual constituencies.
 *
 * Population and GDP figures are approximate (2021 census / ONS estimates).
 * `houseDistricts` maps to Westminster constituency count for the region.
 * `stateSenateSeats` stores the Regional Council seat count for each region.
 */
export const ukRegions: State[] = [
  // ── England ────────────────────────────────────────────────────────────────
  {
    _id: "LON",
    countryId: "UK",
    regionType: "constituency",
    parentRegionId: "ENG",
    name: "London",
    population: 9_000_000,
    gdp: 503_000,
    houseDistricts: 75,
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
    population: 9_300_000,
    gdp: 292_000,
    houseDistricts: 91,
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
    population: 5_700_000,
    gdp: 148_000,
    houseDistricts: 58,
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
    population: 6_300_000,
    gdp: 167_000,
    houseDistricts: 61,
    stateSenateSeats: 39,
    region: "East of England",
    votingSystem: "fptp",
  },
  {
    _id: "EMI",
    countryId: "UK",
    regionType: "constituency",
    parentRegionId: "ENG",
    name: "East Midlands",
    population: 4_900_000,
    gdp: 118_000,
    houseDistricts: 47,
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
    population: 5_900_000,
    gdp: 131_000,
    houseDistricts: 57,
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
    population: 5_500_000,
    gdp: 122_000,
    houseDistricts: 54,
    stateSenateSeats: 21,
    region: "Yorkshire",
    votingSystem: "fptp",
  },
  {
    _id: "NWE",
    countryId: "UK",
    regionType: "constituency",
    parentRegionId: "ENG",
    name: "North West England",
    population: 7_400_000,
    gdp: 179_000,
    houseDistricts: 75,
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
    population: 2_700_000,
    gdp: 54_000,
    houseDistricts: 27,
    stateSenateSeats: 17,
    region: "North East",
    votingSystem: "fptp",
  },
  // ── Scotland ───────────────────────────────────────────────────────────────
  {
    _id: "SCO",
    countryId: "UK",
    regionType: "nation",
    parentRegionId: "SCO",
    name: "Scotland",
    population: 5_440_000,
    gdp: 163_000,
    houseDistricts: 57,
    stateSenateSeats: 129,
    region: "Scotland",
    votingSystem: "fptp",
  },
  // ── Wales ──────────────────────────────────────────────────────────────────
  {
    _id: "WAL",
    countryId: "UK",
    regionType: "nation",
    parentRegionId: "WAL",
    name: "Wales",
    population: 3_170_000,
    gdp: 74_000,
    houseDistricts: 32,
    stateSenateSeats: 60,
    region: "Wales",
    votingSystem: "fptp",
  },
  // ── Northern Ireland ───────────────────────────────────────────────────────
  {
    _id: "NIR",
    countryId: "UK",
    regionType: "nation",
    parentRegionId: "NIR",
    name: "Northern Ireland",
    population: 1_920_000,
    gdp: 48_000,
    houseDistricts: 18,
    stateSenateSeats: 90,
    region: "Northern Ireland",
    votingSystem: "fptp",
  },
];

export default ukRegions;
