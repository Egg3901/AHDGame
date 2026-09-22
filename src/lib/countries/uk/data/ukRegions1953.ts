/**
 * SEED INDEPENDENCE — DO NOT DERIVE FROM ANOTHER ERA.
 * Each era seed is self-contained. This file MUST NOT import and transform
 * another era's region data. All values are authored for 1953 directly.
 * Type-only imports are allowed.
 *
 * UK regions for the 1953-default preset (Churchill's second government;
 * Korean War armistice; Festival of Britain aftermath). The 12 electoral regions
 * are structurally stable; the era-specific values are ~1951-census population,
 * ~1953 regional GVA (GBP millions, nominal — far smaller than later eras), and
 * the **625-seat** Westminster distribution in force 1950–1955 (England 506 /
 * Scotland 71 / Wales 36 / Northern Ireland 12).
 *
 * NOTE (anachronism): `stateSenateSeats` keeps the modern devolved/regional
 * counts (Scottish Parliament 129, Senedd 60, NI Assembly 90), none of which
 * existed in 1953 — era-invariant in this model as per the 1979 seed convention.
 */
import type { State } from "@/lib/db/types";

export const ukRegions1953: State[] = [
  // ── England (506 Westminster seats) ──────────────────────────────────────
  {
    _id: "LON",
    countryId: "UK",
    regionType: "constituency",
    parentRegionId: "ENG",
    name: "London",
    population: 8_200_000,
    gdp: 3_800,
    houseDistricts: 91,
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
    population: 6_100_000,
    gdp: 2_800,
    houseDistricts: 81,
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
    population: 3_400_000,
    gdp: 1_200,
    houseDistricts: 43,
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
    population: 3_700_000,
    gdp: 1_300,
    houseDistricts: 47,
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
    population: 3_200_000,
    gdp: 1_100,
    houseDistricts: 37,
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
    population: 4_700_000,
    gdp: 1_900,
    houseDistricts: 53,
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
    population: 4_600_000,
    gdp: 1_800,
    houseDistricts: 52,
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
    population: 6_500_000,
    gdp: 2_400,
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
    population: 3_100_000,
    gdp: 1_000,
    houseDistricts: 27,
    stateSenateSeats: 17,
    region: "North East",
    votingSystem: "fptp",
  },
  // ── Scotland (71) ────────────────────────────────────────────────────────
  {
    _id: "SCO",
    countryId: "UK",
    regionType: "nation",
    parentRegionId: "SCO",
    name: "Scotland",
    population: 5_100_000,
    gdp: 1_500,
    houseDistricts: 71,
    stateSenateSeats: 129,
    region: "Scotland",
    votingSystem: "fptp",
  },
  // ── Wales (36) ───────────────────────────────────────────────────────────
  {
    _id: "WAL",
    countryId: "UK",
    regionType: "nation",
    parentRegionId: "WAL",
    name: "Wales",
    population: 2_600_000,
    gdp: 630,
    houseDistricts: 36,
    stateSenateSeats: 60,
    region: "Wales",
    votingSystem: "fptp",
  },
  // ── Northern Ireland (12) ────────────────────────────────────────────────
  {
    _id: "NIR",
    countryId: "UK",
    regionType: "nation",
    parentRegionId: "NIR",
    name: "Northern Ireland",
    population: 1_400_000,
    gdp: 370,
    houseDistricts: 12,
    stateSenateSeats: 90,
    region: "Northern Ireland",
    votingSystem: "fptp",
  },
];

export default ukRegions1953;
