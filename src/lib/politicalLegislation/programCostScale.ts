/**
 * Founding program costs retain the expense scale stored in the national budget.
 * loadProgramCostScale supplies catalog-only fiscal views; existing worlds
 * without a stored scale use their original costs.
 */
import type { Db } from "mongodb";
import type { FederalBudget } from "@/lib/db/types/budget";
import { getNationalBudgetId } from "@/lib/bonds/sovereign";
import type { CountryId } from "@/lib/constants/countries";

export function programCostScaleOrDefault(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1
    ? value
    : 1;
}

/** Read the world's fixed founding scale, not a freshly computed fiscal target. */
export async function loadProgramCostScale(db: Db, countryId: string): Promise<number> {
  const budget = await db
    .collection<FederalBudget>("federalBudget")
    .findOne(
      { _id: getNationalBudgetId(countryId as CountryId) },
      { projection: { programCostScaleBaseline: 1 } }
    );
  return programCostScaleOrDefault(budget?.programCostScaleBaseline);
}
