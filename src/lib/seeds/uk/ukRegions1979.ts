/**
 * SEED INDEPENDENCE — DO NOT DERIVE FROM ANOTHER ERA.
 * Each era seed is self-contained. This file MUST NOT import and transform
 * another era's region data. All values are authored for 1979 directly.
 * Type-only imports are allowed.
 *
 * UK regions for the 1979-default preset (the 1979 GE — Thatcher's first
 * victory; "Winter of Discontent" Britain, pre-devolution, pre-Big-Bang). The 12
 * electoral regions are structurally stable; the era-specific values are ~1979
 * (1981-census-anchored) population, ~1979 regional GVA (GBP millions, nominal —
 * far smaller than later eras), and the **635-seat** Westminster distribution in
 * force 1974–1983 (England 516 / Scotland 71 / Wales 36 / Northern Ireland 12 —
 * NI ran on only 12 seats until the 1983 expansion to 17).
 *
 * NOTE (anachronism): `stateSenateSeats` keeps the modern devolved/regional
 * counts (Scottish Parliament 129, Senedd 60, NI Assembly 90), none of which
 * existed in 1979 — the same compromise the 1991 seed documents, since
 * stateSenateSeats is era-invariant in this model. London also sat far larger in
 * the House (92 seats) before the 1983 boundary review.
 */
import type { State } from "@/lib/db/types";

export const ukRegions1979: State[] = [
  // ── England (516 Westminster seats) ──────────────────────────────────────
  {
    _id: "LON",
    countryId: "UK",
    regionType: "constituency",
    parentRegionId: "ENG",
    name: "London",
    population: 6_800_000,
    gdp: 32_000,
    houseDistricts: 92,
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
    population: 7_000_000,
    gdp: 30_000,
    houseDistricts: 82,
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
    population: 4_300_000,
    gdp: 16_000,
    houseDistricts: 44,
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
    population: 4_850_000,
    gdp: 18_000,
    houseDistricts: 48,
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
    population: 3_850_000,
    gdp: 13_000,
    houseDistricts: 38,
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
    population: 5_150_000,
    gdp: 16_000,
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
    population: 4_900_000,
    gdp: 14_000,
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
    population: 6_950_000,
    gdp: 21_000,
    houseDistricts: 77,
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
    population: 2_640_000,
    gdp: 7_600,
    houseDistricts: 25,
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
    population: 5_180_000,
    gdp: 17_000,
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
    population: 2_790_000,
    gdp: 8_000,
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
    population: 1_540_000,
    gdp: 5_000,
    houseDistricts: 12,
    stateSenateSeats: 90,
    region: "Northern Ireland",
    votingSystem: "fptp",
  },
];

export default ukRegions1979;
