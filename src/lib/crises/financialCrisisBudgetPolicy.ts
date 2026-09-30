import type { Db } from "mongodb";
import type { FederalBudget } from "@/lib/db/types";

/** Expire before normal treasury accrual, including between fiscal boundaries. */
export async function expireFinancialCrisisAusterity(
  db: Db,
  budget: FederalBudget,
  turn: number
): Promise<void> {
  const expires = budget.financialCrisisAusterityUntilTurn;
  const spending = budget.financialCrisisAusterityBaseSpending;
  if (expires === undefined || turn < expires || !spending) return;
  const result = await db.collection<FederalBudget>("federalBudget").updateOne(
    {
      _id: budget._id,
      financialCrisisAusterityUntilTurn: expires,
    },
    {
      $set: { spending, surplus: budget.revenue.total - spending.total },
      $unset: { financialCrisisAusterityUntilTurn: "", financialCrisisAusterityBaseSpending: "" },
    }
  );
  if (result.matchedCount === 1) {
    budget.spending = spending;
    budget.surplus = budget.revenue.total - spending.total;
    delete budget.financialCrisisAusterityUntilTurn;
    delete budget.financialCrisisAusterityBaseSpending;
  }
}
