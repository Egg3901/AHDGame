import type { State } from "@/lib/db/types";
import { SUCCESSOR_REGIONS_1991 } from "@/lib/seeds/reference/successorRegions1991";
import { RO_1991_ESTIMATED_REGION_GDP_ROL } from "@/lib/countries/ro/data/roRegionalGdp1991";
import { RO_1991_MACROREGION_POPULATION } from "./roPopulation1991";
import { apportionSeats } from "@/lib/seeds/reference/rules/apportionSeats";

/**
 * The parliament elected in May 1990 had 396 deputies and 119 senators.
 * Both are mapped to game macroregions by 1992 census population, because
 * historical electoral constituencies were counties, not these macroregions.
 * https://data.ipu.org/election-summary/HTML/2261_90.htm
 * https://agerpres.ro/documentare/2020/05/12/romania-post-revolu-ie-primele-alegeri-libere-din-20-mai-1990--508660
 */
const deputySeats = apportionSeats(396, RO_1991_MACROREGION_POPULATION);
const senateSeats = apportionSeats(119, RO_1991_MACROREGION_POPULATION);

export const roRegions1991: State[] = SUCCESSOR_REGIONS_1991.RO.map((region) => ({
  ...region,
  gdp: RO_1991_ESTIMATED_REGION_GDP_ROL[region._id] / 1_000_000,
  houseDistricts: deputySeats[region._id],
  stateSenateSeats: senateSeats[region._id],
  votingSystem: "fptp",
}));
