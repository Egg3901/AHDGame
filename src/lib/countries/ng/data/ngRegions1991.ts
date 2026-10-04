import type { State } from "@/lib/db/types";
import { allocateRegionalGdp } from "@/lib/seeds/reference/rules/allocateRegionalGdp";
import { NG_1991_NOMINAL_GDP_NGN } from "./ngGdp1991";
import { allocatePopulationTotal } from "@/lib/seeds/rules/populationAllocation";
import { POPULATION_TOTALS_1991 } from "@/lib/seeds/reference/populationTotals1991";

/**
 * Nigeria's 6 geopolitical zones, 1991 population model.
 *
 * Population: 1991 National Population Census (88,992,220 national total).
 *   Zone shares are existing model estimates, not verified census aggregates.
 *   Counts are normalized to the NPC total reproduced in NBS Annual Abstract
 *   2011 Table 12; see populationTotals1991.ts.
 * GDP: NGN millions, scaled to WDI's observed 1991 national nominal total.
 *   Relative output shares remain existing oil/agriculture model estimates,
 *   not independently observed regional GDP. See ngGdp1991.ts for the source.
 * House/Senate seats: constitutional allocation unchanged 1991→2019
 *   (360 House, 109 Senate). Zone-level abstraction is a game construct;
 *   zones were created later (Abacha era) but used here for playable regions.
 */
const ngRegionPopulationWeights1991: State[] = [
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

/** Regional counts are estimates normalized to the dated national anchor, not census observations. */
const populatedRegions = allocatePopulationTotal(
  ngRegionPopulationWeights1991,
  POPULATION_TOTALS_1991.NG.population
);
const populations = Object.fromEntries(populatedRegions.map((row) => [row._id, row.population]));
// The original GDP amounts were mis-scaled, but their relative output shares
// remain the model proxy. Express that proxy per resident for the allocator.
const outputPerResident = Object.fromEntries(
  populatedRegions.map((row) => [row._id, row.gdp / row.population])
);
const allocatedGdp = allocateRegionalGdp(NG_1991_NOMINAL_GDP_NGN, populations, outputPerResident);
export const ngRegions1991: State[] = populatedRegions.map((row) => ({
  ...row,
  gdp: allocatedGdp[row._id] / 1_000_000,
}));
