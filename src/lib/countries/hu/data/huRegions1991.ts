import type { State } from "@/lib/db/types";
import { SUCCESSOR_REGIONS_1991 } from "@/lib/seeds/reference/successorRegions1991";
import { HU_1991_ESTIMATED_REGION_GDP_HUF } from "@/lib/countries/hu/data/huRegionalGdp1991";
import { HU_1991_REGION_POPULATION } from "./huPopulation1991";
import { apportionSeats } from "@/lib/seeds/reference/rules/apportionSeats";

/**
 * The National Assembly elected in 1990 had 386 seats and no upper chamber.
 * Its mixed constituency/list seats are allocated across the game's six
 * macroregions by 1990 KSH population; this is a map approximation, not the
 * historical electoral constituency distribution.
 * https://static.valasztas.hu/v98stat/1990pmand.htm
 */
const assemblySeats = apportionSeats(386, HU_1991_REGION_POPULATION);

export const huRegions1991: State[] = SUCCESSOR_REGIONS_1991.HU.map((region) => ({
  ...region,
  gdp: HU_1991_ESTIMATED_REGION_GDP_HUF[region._id] / 1_000_000,
  houseDistricts: assemblySeats[region._id],
  stateSenateSeats: 0,
  votingSystem: "fptp",
}));
