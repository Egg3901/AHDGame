/**
 * Founding program costs retain the expense scale stored in the national budget.
 * loadProgramCostScale supplies catalog-only fiscal views; existing worlds
 * without a stored scale use their original costs.
 */
import type { Db } from "mongodb";
import type { FederalBudget } from "@/lib/db/types/budget";
import { getNationalBudgetId } from "@/lib/bonds/sovereign";
import type { CountryId } from "@/lib/constants/countries";
import { budgetKeyForLaw } from "./budgetKeys";
import type { PoliticalLaw } from "./types";

type ProgramCostScaleBaselines = Pick<
  FederalBudget,
  "programCostScaleBaseline" | "programCostScaleByCategoryBaseline"
>;

export function programCostScaleOrDefault(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1
    ? value
    : 1;
}

/** A national law's founding scale: its budget category's, else the book-wide one. */
export function programCostScaleForLaw(
  budget: ProgramCostScaleBaselines | null | undefined,
  law: PoliticalLaw
): number {
  const categoryScale = budget?.programCostScaleByCategoryBaseline?.[budgetKeyForLaw(law)];
  return typeof categoryScale === "number" && Number.isFinite(categoryScale) && categoryScale >= 0
    ? categoryScale
    : programCostScaleOrDefault(budget?.programCostScaleBaseline);
}

/** Read the world's fixed founding scales, not a freshly computed fiscal target. */
export async function loadProgramCostScale(
  db: Db,
  countryId: string
): Promise<(law: PoliticalLaw) => number> {
  const budget = await db
    .collection<FederalBudget>("federalBudget")
    .findOne(
      { _id: getNationalBudgetId(countryId as CountryId) },
      { projection: { programCostScaleBaseline: 1, programCostScaleByCategoryBaseline: 1 } }
    );
  return (law) => programCostScaleForLaw(budget, law);
}
