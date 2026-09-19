import type { State } from "@/lib/db/types";

/**
 * Nigeria's 6 geopolitical zones, 1991 Census data.
 *
 * Population: 1991 National Population Census (88,992,220 total).
 *   Aggregated from state-level census figures to zone level.
 *   Source: citypopulation.de / Nigerian National Population Commission.
 * GDP: 1991 nominal regional estimates (NGN millions). Nigeria's 1991 GDP was
 *   roughly ₦260–300 billion; figures are proportional approximations based
 *   on oil production (South-South, South-West) and agricultural dominance
 *   (North-East, North-West). Not precise — era-appropriate ballpark.
 * House/Senate seats: constitutional allocation unchanged 1991→2019
 *   (360 House, 109 Senate). Zone-level abstraction is a game construct;
 *   zones were created later (Abacha era) but used here for playable regions.
 */
export const ngRegions1991: State[] = [
  // ── North-West ───────────────────────────────────────────────────────────────
  {
    _id: "NORTH_WEST",
    countryId: "NG",
    regionType: "state",
    name: "North-West",
    population: 22_913_412,
    gdp: 35_000_000,
    houseDistricts: 95,
    stateSenateSeats: 21,
    region: "North-West",
    votingSystem: "fptp",
  },

  // ── North-East ───────────────────────────────────────────────────────────────
  {
    _id: "NORTH_EAST",
    countryId: "NG",
    regionType: "state",
    name: "North-East",
    population: 11_900_913,
    gdp: 22_000_000,
    houseDistricts: 50,
    stateSenateSeats: 18,
    region: "North-East",
    votingSystem: "fptp",
  },

  // ── North-Central ────────────────────────────────────────────────────────────
  {
    _id: "NORTH_CENTRAL",
    countryId: "NG",
    regionType: "state",
    name: "North-Central",
    population: 12_554_912,
    gdp: 28_000_000,
    houseDistricts: 53,
    stateSenateSeats: 18,
    region: "North-Central",
    votingSystem: "fptp",
  },

  // ── South-West ───────────────────────────────────────────────────────────────
  {
    _id: "SOUTH_WEST",
    countryId: "NG",
    regionType: "state",
    name: "South-West",
    population: 17_455_043,
    gdp: 72_000_000,
    houseDistricts: 72,
    stateSenateSeats: 18,
    region: "South-West",
    votingSystem: "fptp",
  },

  // ── South-South ───────────────────────────────────────────────────────────────
  {
    _id: "SOUTH_SOUTH",
    countryId: "NG",
    regionType: "state",
    name: "South-South",
    population: 13_392_943,
    gdp: 58_000_000,
    houseDistricts: 47,
    stateSenateSeats: 18,
    region: "South-South",
    votingSystem: "fptp",
  },

  // ── South-East ───────────────────────────────────────────────────────────────
  {
    _id: "SOUTH_EAST",
    countryId: "NG",
    regionType: "state",
    name: "South-East",
    population: 10_774_977,
    gdp: 26_000_000,
    houseDistricts: 43,
    stateSenateSeats: 16,
    region: "South-East",
    votingSystem: "fptp",
  },
];
