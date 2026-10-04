import type { State } from "@/lib/db/types";
import { SUCCESSOR_REGIONS_1991 } from "@/lib/seeds/reference/successorRegions1991";
import { CS_1991_ESTIMATED_REGION_GDP_CSK } from "@/lib/seeds/reference/csRegionalGdp1991";
import { CS_1991_REGION_POPULATION } from "./csPopulation1991";
import { apportionSeats } from "@/lib/seeds/reference/rules/apportionSeats";

/**
 * The June 1990 federal election chose 150 members to each chamber. The
 * Chamber of Nations split 75/75 between the Czech and Slovak republics.
 * House of People seats and the Czech half of Nations seats are apportioned
 * across the game's four macroregions by the March 1991 census.
 * https://www.csce.gov/wp-content/uploads/2016/10/Report-on-the-Elections-in-the-Czech-and-Slovak-Federal-Republic.pdf
 */
const peopleSeats = apportionSeats(150, CS_1991_REGION_POPULATION);
const czechNationSeats = apportionSeats(75, {
  CS_PRG: CS_1991_REGION_POPULATION.CS_PRG,
  CS_BOH: CS_1991_REGION_POPULATION.CS_BOH,
  CS_MOR: CS_1991_REGION_POPULATION.CS_MOR,
});

export const csRegions1991: State[] = SUCCESSOR_REGIONS_1991.CS.map((region) => ({
  ...region,
  gdp: CS_1991_ESTIMATED_REGION_GDP_CSK[region._id] / 1_000_000,
  houseDistricts: peopleSeats[region._id],
  stateSenateSeats: region._id === "CS_SVK" ? 75 : czechNationSeats[region._id],
  votingSystem: "fptp",
}));
