/**
 * SE 1991 population model: older regional shares normalized to a dated national total.
 * GDP, seats and geography retain existing inputs. Regional population counts are
 * estimates; source dates and territorial scope live in populationTotals1991.ts.
 */
import { seRegions } from "./seRegions";
import { allocatePopulationTotal } from "@/lib/seeds/rules/populationAllocation";
import { POPULATION_TOTALS_1991 } from "@/lib/seeds/reference/populationTotals1991";

export const seRegions1991 = allocatePopulationTotal(
  seRegions,
  POPULATION_TOTALS_1991.SE.population
);
