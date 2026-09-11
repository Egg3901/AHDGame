import type { BankCharter } from "@/lib/db/types/bank";
import {
  BANK_EQUITY_VALUATION_WEIGHT,
  NPV_ANNUAL_DISCOUNT_RATE,
} from "@/lib/constants/corporations";
import { TURNS_PER_YEAR } from "@/lib/constants/turnTime";
import {
  bankEquity,
  type BalanceSheetCharter,
  type BalanceSheetOptions,
} from "@/lib/banking/rules/balanceSheet";

/**
 * The holding company owns the bank's residual claim, not its ring-fenced
 * deposits. Keep the book claim and the recognized valuation separate: the
 * latter is the same 75% haircut used by the share-price formula.
 */
export function bankBookEquity(
  charter: BalanceSheetCharter | BankCharter | null | undefined,
  options: BalanceSheetOptions = {}
): number {
  return bankEquity(charter, options);
}

export function bankValuation(
  charter: BalanceSheetCharter | BankCharter | null | undefined,
  options: BalanceSheetOptions = {}
): number {
  return BANK_EQUITY_VALUATION_WEIGHT * bankBookEquity(charter, options);
}

/**
 * Convert realized per-turn bank income into the same going-concern NPV basis
 * used by sector NPVs. Loss-making activities have no positive NPV floor,
 * matching the existing sector valuation convention.
 */
export function bankNpvFromPerTurnIncome(perTurnIncome: number | null | undefined): number {
  const income =
    typeof perTurnIncome === "number" && Number.isFinite(perTurnIncome) ? perTurnIncome : 0;
  const annualIncome = income * TURNS_PER_YEAR;
  return annualIncome > 0 ? Math.round(annualIncome / NPV_ANNUAL_DISCOUNT_RATE) : 0;
}
