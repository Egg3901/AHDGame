import type { Db } from "mongodb";
import type { FederalBudget, SovereignRiskAnchor } from "@/lib/db/types/budget";
import { seedRegistrationLanes } from "@/lib/admin/seed/seedRegistrationLanes";
import {
  calculateCreditRating,
  calculateInterestRate,
  getSovereignConfidencePremium,
} from "@/lib/budget/debt";
import { getInitialNationalBudgetsForPreset } from "@/lib/seeds/reference/budgets";
import type { Migration, MigrationResult } from "../types";

const PRESET = "1953-default";

async function heal1953SeedBalance(db: Db, dryRun: boolean): Promise<MigrationResult> {
  const gameState = await db
    // Typed inline: an untyped handle defaults `_id` to ObjectId, and the
    // gameState singleton is keyed by the string "current".
    .collection<{ _id: string; preset?: string }>("gameState")
    .findOne({ _id: "current" }, { projection: { preset: 1 } });
  if (gameState?.preset !== PRESET) {
    return { notes: [`skipped: active preset is ${String(gameState?.preset ?? "unknown")}`] };
  }

  const authoredBudgets = getInitialNationalBudgetsForPreset(PRESET);
  const anchors = new Map<string, SovereignRiskAnchor>(
    authoredBudgets.map((budget) => [budget.countryId, budget.sovereignRiskAnchor!])
  );
  const currentBudgets = await db
    .collection<FederalBudget>("federalBudget")
    .find({ countryId: { $in: [...anchors.keys()] } })
    .toArray();

  if (dryRun) {
    return {
      documentsScanned: currentBudgets.length + 80,
      documentsUpdated: 0,
      notes: [
        `would reconcile 80 US/UK/RU/DD registration regions for ${PRESET}`,
        `would anchor and reprice ${currentBudgets.length} current sovereign budgets`,
      ],
    };
  }

  const registration = await seedRegistrationLanes(db, PRESET);
  let budgetsUpdated = 0;
  for (const budget of currentBudgets) {
    const anchor = anchors.get(budget.countryId);
    if (!anchor) continue;
    const ratioGdp = budget.gdpSmoothed && budget.gdpSmoothed > 0 ? budget.gdpSmoothed : budget.gdp;
    const principal = Math.max(0, -(budget.treasuryBalance ?? -budget.debt.principal));
    const debtToGdpRatio = ratioGdp > 0 ? principal / ratioGdp : 0;
    const interestRate =
      calculateInterestRate(debtToGdpRatio, budget.imfSovereignBailoutActive, anchor) +
      getSovereignConfidencePremium(budget.investorConfidence);
    const debtInterest = principal * interestRate;
    const priorDebtInterest = budget.spending.debtInterest ?? 0;
    const spendingTotal = Math.max(0, budget.spending.total - priorDebtInterest + debtInterest);

    await db.collection<FederalBudget>("federalBudget").updateOne(
      { _id: budget._id },
      {
        $set: {
          sovereignRiskAnchor: anchor,
          debtToGdpRatio,
          creditRating: calculateCreditRating(debtToGdpRatio, anchor),
          "debt.principal": principal,
          "debt.interestRate": interestRate,
          "spending.debtInterest": debtInterest,
          "spending.total": spendingTotal,
          surplus: (budget.revenue.total ?? 0) - spendingTotal,
        },
      }
    );
    budgetsUpdated += 1;
  }

  return {
    documentsScanned: currentBudgets.length + registration.rowsProcessed,
    documentsUpdated:
      budgetsUpdated + registration.partyOrgRowsUpdated + registration.poolRowsUpserted,
    documentsDeleted: registration.poolRowsDeleted,
    notes: [
      `registration rows=${registration.rowsProcessed}, warnings=${registration.warnings.length}`,
      `sovereign budgets repriced=${budgetsUpdated}`,
    ],
  };
}

export const migration: Migration = {
  id: "2026-08-09-heal-1953-seed-balance",
  description:
    "Reconcile 1953 registration pools and backfill era-relative sovereign risk anchors.",
  idempotent: true,
  execute: (db, ctx) => heal1953SeedBalance(db, ctx.dryRun),
};
