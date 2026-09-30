/** Named components of the existing signed treasury accrual, without new cash rules. */
import type { TreasuryAccrualReceipt } from "@/lib/db/types/budget";
import { TURNS_PER_YEAR } from "@/lib/constants/turnTime";
import type { LedgerLeg } from "@/lib/ledger/types";

export function treasuryAccrualReceipt(
  input: Omit<TreasuryAccrualReceipt, "cashDelta" | "components"> & {
    annualRevenue: number;
    annualPrimarySpending: number;
    debtService: number;
    enforcement: number;
  }
): TreasuryAccrualReceipt {
  const { annualRevenue, annualPrimarySpending, debtService, enforcement, ...context } = input;
  const revenue = annualRevenue / TURNS_PER_YEAR;
  const primarySpending = annualPrimarySpending / TURNS_PER_YEAR;
  const rawDelta = revenue - primarySpending - debtService - enforcement;
  // Preserve the existing operation order and whole-unit treasury rounding.
  const primaryPerTurn = (annualRevenue - annualPrimarySpending) / TURNS_PER_YEAR;
  const cashDelta =
    Math.round(input.openingCash + primaryPerTurn - debtService - enforcement) - input.openingCash;
  return {
    ...context,
    cashDelta,
    components: {
      revenue,
      primarySpending: -primarySpending,
      debtService: -debtService,
      enforcement: -enforcement,
      rounding: cashDelta - rawDelta,
    },
  };
}

export function treasuryAccrualLegs(
  countryId: string,
  receipt: TreasuryAccrualReceipt
): LedgerLeg[] {
  const legs: LedgerLeg[] = [];
  const reasons = {
    revenue: "fiscal_revenue",
    primarySpending: "fiscal_primary_spending",
    debtService: "fiscal_debt_service",
    enforcement: "fiscal_union_enforcement",
    rounding: "fiscal_cash_rounding",
  };
  for (const [key, amount] of Object.entries(receipt.components)) {
    if (amount === 0) continue;
    const currency = receipt.currencyCode;
    legs.push({
      account: `government:${countryId}:${currency}`,
      amount,
      currencyCode: currency,
      anchorAmount: amount / receipt.anchorRate,
      role: "primary",
    });
    legs.push({
      account: `${amount > 0 ? "mint" : "sink"}:${reasons[key as keyof typeof reasons]}:${currency}`,
      amount: -amount,
      currencyCode: currency,
      anchorAmount: -amount / receipt.anchorRate,
      role: "contra",
    });
  }
  return legs;
}
