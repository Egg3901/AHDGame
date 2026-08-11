/**
 * SEED INDEPENDENCE — DO NOT DERIVE FROM ANOTHER ERA.
 * Each era seed is self-contained. This file MUST NOT import and transform
 * another era's region data. All values are authored for 2023 directly.
 * Type-only imports are allowed.
 *
 * UK regions for the 2023-default preset (post-2019-election Westminster, pre-
 * 2024-boundary-review). The 12 electoral regions are structurally stable; the
 * era-specific values are 2023 ONS mid-year population, 2022 regional GVA, and
 * the **650-seat** Westminster distribution in force 2010–2024
 * (England 533 / Scotland 59 / Wales 40 / NI 18). `stateSenateSeats` holds the
 * devolved/regional-council seat count.
 */
import type { State } from "@/lib/db/types";

export const ukRegions2023: State[] = [
  // ── England (533 Westminster seats) ──────────────────────────────────────
  {
    _id: "LON",
    countryId: "UK",
    regionType: "constituency",
    parentRegionId: "ENG",
    name: "London",
    population: 8_900_000,
    gdp: 526_000,
    houseDistricts: 73,
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
    population: 9_400_000,
    gdp: 312_000,
    houseDistricts: 84,
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
    population: 5_760_000,
    gdp: 158_000,
    houseDistricts: 55,
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
    population: 6_400_000,
    gdp: 178_000,
    houseDistricts: 58,
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
    population: 4_960_000,
    gdp: 126_000,
    houseDistricts: 46,
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
    population: 6_020_000,
    gdp: 142_000,
    houseDistricts: 59,
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
    population: 5_540_000,
    gdp: 132_000,
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
    population: 7_500_000,
    gdp: 193_000,
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
    population: 2_650_000,
    gdp: 58_000,
    houseDistricts: 29,
    stateSenateSeats: 17,
    region: "North East",
    votingSystem: "fptp",
  },
  // ── Scotland (59) ────────────────────────────────────────────────────────
  {
    _id: "SCO",
    countryId: "UK",
    regionType: "nation",
    parentRegionId: "SCO",
    name: "Scotland",
    population: 5_490_000,
    gdp: 168_000,
    houseDistricts: 59,
    stateSenateSeats: 129,
    region: "Scotland",
    votingSystem: "fptp",
  },
  // ── Wales (40) ───────────────────────────────────────────────────────────
  {
    _id: "WAL",
    countryId: "UK",
    regionType: "nation",
    parentRegionId: "WAL",
    name: "Wales",
    population: 3_160_000,
    gdp: 78_000,
    houseDistricts: 40,
    stateSenateSeats: 60,
    region: "Wales",
    votingSystem: "fptp",
  },
  // ── Northern Ireland (18) ────────────────────────────────────────────────
  {
    _id: "NIR",
    countryId: "UK",
    regionType: "nation",
    parentRegionId: "NIR",
    name: "Northern Ireland",
    population: 1_920_000,
    gdp: 50_000,
    houseDistricts: 18,
    stateSenateSeats: 90,
    region: "Northern Ireland",
    votingSystem: "fptp",
  },
];

export default ukRegions2023;
