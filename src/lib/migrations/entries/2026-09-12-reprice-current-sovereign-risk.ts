import type { Db } from "mongodb";
import type { FederalBudget } from "@/lib/db/types/budget";
import { deriveFiscalState } from "@/lib/budget/treasuryBalance";
import type { Migration, MigrationResult } from "../types";

/**
 * Reprice persisted sovereign fields after removing the historical-anchor
 * rescaling from the runtime debt ladder.
 *
 * This deliberately leaves `sovereignRiskAnchor` untouched. It is historical
 * seed/migration provenance, not a live risk input. Principal and the signed
 * treasury balance are also untouched; only fields derived from them are
 * brought into line with the current model.
 */
async function repriceCurrentSovereignRisk(db: Db, dryRun: boolean): Promise<MigrationResult> {
  const budgets = await db
    .collection<FederalBudget>("federalBudget")
    .find({ mergedInto: { $exists: false } })
    .toArray();

  let budgetsUpdated = 0;
  const notes: string[] = [];

  for (const budget of budgets) {
    const derived = deriveFiscalState({
      treasuryBalance: budget.treasuryBalance ?? -budget.debt.principal,
      gdp: budget.gdp,
      gdpSmoothed: budget.gdpSmoothed,
      ceiling: budget.debt.ceiling,
      investorConfidence: budget.investorConfidence,
      imfBailoutActive: budget.imfSovereignBailoutActive,
      sovereignRiskAnchor: budget.sovereignRiskAnchor,
    });
    const debtInterest = derived.principal * derived.interestRate;
    const priorDebtInterest = budget.spending.debtInterest ?? 0;
    const spendingTotal = Math.max(0, budget.spending.total - priorDebtInterest + debtInterest);
    const update = {
      "debt.principal": derived.principal,
      "debt.interestRate": derived.interestRate,
      debtToGdpRatio: derived.debtToGdpRatio,
      creditRating: derived.creditRating,
      "spending.debtInterest": debtInterest,
      "spending.total": spendingTotal,
      surplus: (budget.revenue.total ?? 0) - spendingTotal,
    };

    const changed =
      budget.debt.principal !== update["debt.principal"] ||
      budget.debt.interestRate !== update["debt.interestRate"] ||
      budget.debtToGdpRatio !== update.debtToGdpRatio ||
      budget.creditRating !== update.creditRating ||
      budget.spending.debtInterest !== update["spending.debtInterest"] ||
      budget.spending.total !== update["spending.total"] ||
      budget.surplus !== update.surplus;

    if (!changed) continue;
    budgetsUpdated += 1;

    if (!dryRun) {
      await db
        .collection<FederalBudget>("federalBudget")
        .updateOne({ _id: budget._id }, { $set: update });
    }

    if (budget.countryId === "DD") {
      notes.push(
        `${dryRun ? "would reprice" : "repriced"} DD: ${derived.creditRating} at ${(derived.interestRate * 100).toFixed(1)}%`
      );
    }
  }

  return {
    documentsScanned: budgets.length,
    documentsUpdated: dryRun ? 0 : budgetsUpdated,
    notes: [
      `${dryRun ? "would reprice" : "repriced"} ${budgetsUpdated} active sovereign budgets`,
      ...notes,
    ],
  };
}

export const migration: Migration = {
  id: "2026-09-12-reprice-current-sovereign-risk",
  description:
    "Reprice persisted sovereign ratings, interest, and fiscal totals from current debt/GDP rather than historical seed anchors. Ticket #1269.",
  idempotent: true,
  execute: (db, ctx) => repriceCurrentSovereignRisk(db, ctx.dryRun),
};
