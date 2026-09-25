import type { State } from "@/lib/db/types";
import { SUCCESSOR_REGIONS_1991 } from "@/lib/seeds/reference/successorRegions1991";
import { BG_1991_ESTIMATED_REGION_GDP_BGL } from "@/lib/countries/bg/data/bgRegionalGdp1991";
import { BG_1991_MACROREGION_POPULATION } from "./bgPopulation1991";
import { apportionSeats } from "@/lib/seeds/reference/rules/apportionSeats";

/**
 * The 1990 Grand National Assembly had 400 members. Seats here are allocated
 * by census population to the game's five macroregions, not historical
 * electoral constituencies.
 * https://www.iri.org/wp-content/uploads/legacy/iri.org/fields/field_eo_report/bulgarias_1991_parliamentary_and_local_elections.pdf
 */
const assemblySeats = apportionSeats(400, BG_1991_MACROREGION_POPULATION);

export const bgRegions1991: State[] = SUCCESSOR_REGIONS_1991.BG.map((region) => ({
  ...region,
  gdp: BG_1991_ESTIMATED_REGION_GDP_BGL[region._id] / 1_000_000,
  houseDistricts: assemblySeats[region._id],
  stateSenateSeats: 0,
  votingSystem: "fptp",
}));
