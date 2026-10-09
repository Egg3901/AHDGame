/**
 * Shell loader for the inflation gap (inflation minus target, in pp) that
 * widens the hike cap. It reads the same stored national inflation and era
 * target the committee's macro context uses, so the API check, the committee
 * panel and the rate card all agree with the autonomous chair.
 */
import type { Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { FederalBudget } from "@/lib/db/types/budget";
import { getNationalBudgetId } from "@/lib/bonds/sovereign";
import { getInflationTarget } from "@/lib/budget/inflation";

export interface InflationVsTarget {
  inflation: number;
  target: number;
  /** inflation minus target, in pp. */
  gap: number;
}

export async function loadInflationVsTarget(
  db: Db,
  anchorCountryId: CountryId,
  currentYear: number | null | undefined
): Promise<InflationVsTarget | null> {
  const budget = await db
    .collection<FederalBudget>("federalBudget")
    .findOne({ _id: getNationalBudgetId(anchorCountryId) } as { _id: "federal" }, {
      projection: { "economicFactors.inflationRate": 1 },
    });
  const inflation = budget?.economicFactors?.inflationRate;
  if (typeof inflation !== "number" || !Number.isFinite(inflation)) return null;
  const target = getInflationTarget(anchorCountryId, currentYear);
  return { inflation, target, gap: inflation - target };
}
