/**
 * Per-turn recovery processor — runs from the bond turn pipeline.
 *
 * Iterates every country in `recovering` state, computes the transition,
 * persists, and emits a recovery-complete news event on exit.
 */

import type { Db } from "mongodb";
import type { FederalBudget } from "@/lib/db/types/budget";
import { isInGoodFiscalStanding } from "./fiscalStanding";
import { computeRecoveryTransition } from "./computeTransition";
import { emitRecoveryCompleteNews } from "../crisisNews";

export interface RecoveryTurnReport {
  countriesEvaluated: number;
  countriesExited: string[];
}

export async function processSovereignRecoveryTurn(
  db: Db,
  currentTurn: number
): Promise<RecoveryTurnReport> {
  const recovering = await db
    .collection<FederalBudget>("federalBudget")
    .find({ sovereignCrisisState: "recovering" })
    .toArray();

  const countriesExited: string[] = [];

  for (const budget of recovering) {
    const inGoodStanding = isInGoodFiscalStanding({
      revenueTotal: budget.revenue?.total ?? 0,
      spendingTotal: budget.spending?.total ?? 0,
      spendingDebtInterest: budget.spending?.debtInterest ?? 0,
    });

    const transition = computeRecoveryTransition({
      currentState: budget.sovereignCrisisState,
      recoveryStartedAtTurn: budget.recoveryStartedAt?.turn ?? null,
      fiscalDisciplineStreak: budget.recoveryFiscalDisciplineStreak ?? 0,
      inGoodStanding,
      currentTurn,
      recoveryGdpPenaltyTurnsRemaining: budget.recoveryGdpPenaltyTurnsRemaining ?? null,
    });

    if (Object.keys(transition.set).length === 0) continue;

    await db
      .collection<FederalBudget>("federalBudget")
      .updateOne({ _id: budget._id }, { $set: transition.set });

    if (transition.exitedRecovery) {
      const code = budget.countryId ?? String(budget._id);
      countriesExited.push(code);
      await emitRecoveryCompleteNews(code, currentTurn);
    }
  }

  return {
    countriesEvaluated: recovering.length,
    countriesExited,
  };
}
