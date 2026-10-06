/**
 * ES 1991 population model: older regional shares normalized to a dated national total.
 * Seats and geography retain existing inputs. Regional population counts are
 * estimates; source dates and territorial scope live in populationTotals1991.ts.
 *
 * GDP: authored regional shares scaled to the sourced 1991 national nominal
 * total (WDI NY.GDP.MKTP.CN in legacy currency, see fiscalAnchors1991.ts).
 * The shares are model estimates, not observed regional accounts.
 */
import { esRegions } from "./esRegions";
import { allocatePopulationTotal } from "@/lib/seeds/rules/populationAllocation";
import { scaleRegionalGdpToNational } from "@/lib/seeds/reference/rules/anchorBudget1991";
import { gdp1991LegacyLcu } from "@/lib/constants/fiscalAnchors1991";
import { POPULATION_TOTALS_1991 } from "@/lib/seeds/reference/populationTotals1991";

export const esRegions1991 = scaleRegionalGdpToNational(
  allocatePopulationTotal(esRegions, POPULATION_TOTALS_1991.ES.population),
  gdp1991LegacyLcu("ES")
);
