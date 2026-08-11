import type { Db } from "mongodb";
import type { Character } from "@/lib/db/types";
import type { FinancialTxLogEntry } from "@/lib/db/types/financialTxLog";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { getHomeCurrency } from "@/lib/currency/characterFunds";
import { getGameState } from "@/lib/gameState";
import { fromInternalUnits, toInternalUnits } from "./locMath";

/**
 * LOC underwriting uses a rolling income average instead of a one-turn snapshot.
 * This keeps short-lived income spikes from instantly inflating the credit limit.
 */
export const LOC_INCOME_AVERAGING_TURNS = 48;

const LOC_RECURRING_INCOME_TX_TYPES: FinancialTxLogEntry["type"][] = [
  "bond_coupon",
  "corp_dividend",
  "corp_salary",
];

/**
 * Average recurring personal income per turn in home-currency face units.
 * Uses actual paid recurring-income tx rows over the recent underwriting window
 * rather than live holdings, so LOC limits reflect demonstrated income history.
 */
export async function estimatePerTurnCurrencyIncomeHomeFace(
  db: Db,
  character: Character,
  rates: Partial<Record<CurrencyCode, number>>
): Promise<number> {
  const home = getHomeCurrency(character);
  const rateHome = rates[home] ?? 1;
  const currentTurn = Math.max(1, (await getGameState(db))?.currentTurn ?? 1);
  const observationTurns = Math.min(LOC_INCOME_AVERAGING_TURNS, currentTurn);
  const windowStartTurn = currentTurn - observationTurns + 1;

  const rows = await db
    .collection<FinancialTxLogEntry>("financialTxLog")
    .find({
      subjectType: "character",
      subjectId: character._id,
      type: { $in: LOC_RECURRING_INCOME_TX_TYPES },
      amount: { $gt: 0 },
      turn: { $gte: windowStartTurn, $lte: currentTurn },
    })
    .project({ amount: 1, currencyCode: 1, anchorAmount: 1 })
    .toArray();

  let totalInternal = 0;
  for (const row of rows) {
    if (typeof row.anchorAmount === "number" && Number.isFinite(row.anchorAmount)) {
      totalInternal += row.anchorAmount;
      continue;
    }

    const currencyCode = row.currencyCode as CurrencyCode;
    const rate = rates[currencyCode];
    if (!rate || rate <= 0) continue;
    totalInternal += toInternalUnits(row.amount, rate);
  }

  const averageInternalPerTurn = observationTurns > 0 ? totalInternal / observationTurns : 0;
  return fromInternalUnits(averageInternalPerTurn, rateHome);
}
