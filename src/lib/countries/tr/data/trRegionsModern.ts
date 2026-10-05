/**
 * Modern Turkish regions use dated 2023 population weights for modern presets.
 * Population, seat, and GDP values are separately allocated to existing game anchors.
 * The data retains the game's eight stable macro-region IDs and boundaries.
 */
import type { State } from "@/lib/db/types";
import { allocatePopulationTotal } from "@/lib/seeds/rules/populationAllocation";
import { trRegions } from "./trRegions";

// Observed counts from TurkStat ABPRS 2023, release 49684, reference date 31 Dec 2023:
// https://veriportali.tuik.gov.tr/en/press/49684. NUTS groups map to the eight existing
// game regions; Ankara (TR51) is split from TR5 and Central Anatolia uses TR52 + TR7.
// Keep these raw source counts separate from modeled values below. The game uses its
// existing 83.4M population and 26.2T GDP anchors; 2019 and 2027 are projections from
// this 2023 weighting vintage, not observations for those years.
export const TR_2023_SOURCE_POPULATION = {
  // TR1 Istanbul + TR2 West Marmara + TR4 East Marmara.
  TR_IST: 28_062_573,
  // TR51 Ankara (split out of TR5 West Anatolia).
  TR_ANK: 5_803_482,
  // TR3 Aegean.
  TR_IZM: 10_946_780,
  // TR6 Mediterranean.
  TR_MED: 10_851_089,
  // TR8 West Black Sea + TR9 East Black Sea.
  TR_BLA: 7_463_804,
  // TRA Northeast Anatolia + TRB Central East Anatolia.
  TR_ESA: 6_068_540,
  // TRC Southeast Anatolia.
  TR_SEA: 9_410_624,
  // TR52 Konya/Karaman + TR7 Central Anatolia.
  TR_CEN: 6_765_485,
} as const;

export const TR_2023_OBSERVED_POPULATION = 85_372_377;
export const TR_MODERN_GAME_POPULATION = 83_400_000;
export const TR_MODERN_GAME_GDP = 26_200_000_000_000;
export const TR_MODERN_HOUSE_SEATS = 600;

const sourceWeights = trRegions.map((region) => ({
  _id: region._id,
  population: TR_2023_SOURCE_POPULATION[region._id as keyof typeof TR_2023_SOURCE_POPULATION],
}));
const modeledPopulations = allocatePopulationTotal(sourceWeights, TR_MODERN_GAME_POPULATION);
// Reuse the portable deterministic largest-remainder allocator for seats and
// modeled GDP as well as population. For seats, observed population is the weight;
// for GDP, model population distributes the existing national total uniformly per capita.
const seatAllocation = allocatePopulationTotal(sourceWeights, TR_MODERN_HOUSE_SEATS);
const seatsById = new Map(seatAllocation.map((region) => [region._id, region.population]));
const regionalGdp = allocatePopulationTotal(modeledPopulations, TR_MODERN_GAME_GDP);
const gdpById = new Map(regionalGdp.map((region) => [region._id, region.population]));
const modeledPopulationById = new Map(
  modeledPopulations.map((region) => [region._id, region.population])
);

export const trRegionsModern: State[] = trRegions.map((region) => ({
  _id: region._id,
  countryId: region.countryId,
  regionType: region.regionType,
  name: region.name,
  region: region.region,
  votingSystem: region.votingSystem,
  population: modeledPopulationById.get(region._id)!,
  // Explicit model allocation: uniform per-capita output from the existing
  // national game GDP anchor, not observed regional GDP.
  gdp: gdpById.get(region._id)!,
  houseDistricts: seatsById.get(region._id)!,
  stateSenateSeats: 0,
}));

/** All modern presets project the same source vintage, by explicit decision. */
export const trRegions2019 = trRegionsModern;
export const trRegions2023 = trRegionsModern;
export const trRegions2027 = trRegionsModern;
