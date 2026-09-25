import type { State } from "@/lib/db/types";
import { PL_1991_MACROREGION_VOIVODESHIPS } from "./plPopulation1991";
import { SUCCESSOR_REGIONS_1991 } from "@/lib/seeds/reference/successorRegions1991";
import { PL_1991_ESTIMATED_REGION_GDP_PLZ } from "@/lib/countries/pl/data/plRegionalGdp1991";
import { PL_1991_MACROREGION_POPULATION } from "./plPopulation1991";
import { apportionSeats } from "@/lib/seeds/reference/rules/apportionSeats";

/**
 * January 1991 Poland still had the 1989 Contract Sejm's 460 deputies and
 * a 100-seat Senate. Sejm seats are apportioned to the game's macroregions by
 * 1990 population, since those eight regions are aggregations rather than
 * historical Sejm constituencies. Senate seats use the 1989 law exactly:
 * two per voivodeship, plus a third for Warsaw and Katowice.
 * https://libr.sejm.gov.pl/file/history_sejm.pdf
 * https://api.sejm.gov.pl/eli/acts/DU/1989/103/text.html
 */
const SEJM_SEATS_BY_MACROREGION = apportionSeats(460, PL_1991_MACROREGION_POPULATION);

export const plRegions1991: State[] = SUCCESSOR_REGIONS_1991.PL.map((region) => ({
  ...region,
  gdp: PL_1991_ESTIMATED_REGION_GDP_PLZ[region._id] / 1_000_000,
  houseDistricts: SEJM_SEATS_BY_MACROREGION[region._id],
  stateSenateSeats:
    2 *
      PL_1991_MACROREGION_VOIVODESHIPS[region._id as keyof typeof PL_1991_MACROREGION_VOIVODESHIPS]
        .length +
    (region._id === "PL_MAZ" || region._id === "PL_SLK" ? 1 : 0),
  votingSystem: "fptp",
}));
