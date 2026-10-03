import type { State } from "@/lib/db/types";
import { SUCCESSOR_REGIONS_1991 } from "@/lib/seeds/reference/successorRegions1991";
import { RU_1991_ESTIMATED_REGION_GDP_RUB } from "@/lib/seeds/reference/ruRegionalGdp1991";
import { RU_1991_ECONOMIC_REGION_POPULATION } from "./ruPopulation1991";
import { apportionSeats } from "@/lib/seeds/reference/rules/apportionSeats";

/**
 * The RSFSR Congress of People's Deputies had 1,068 seats elected in 1990.
 * Allocation to the game's ten economic regions is a population approximation;
 * the actual election reserved territorial and national-territorial places.
 * The 252-member Supreme Soviet was chosen from Congress, not an independent
 * national upper chamber, so stateSenateSeats is zero.
 * https://www.congress.gov/102/crecb/1992/01/30/GPO-CRECB-1992-pt1-9.pdf
 */
const congressSeats = apportionSeats(1_068, RU_1991_ECONOMIC_REGION_POPULATION);

export const ruRegions1991: State[] = SUCCESSOR_REGIONS_1991.RU.map((region) => ({
  ...region,
  gdp: RU_1991_ESTIMATED_REGION_GDP_RUB[region._id] / 1_000_000,
  houseDistricts: congressSeats[region._id],
  stateSenateSeats: 0,
  votingSystem: "fptp",
}));
