import { applyAusterityCap, type SpendingShape } from "@/lib/sovereignDefault/austerity";

/** Consolidation cuts primary spending, never a contractual bond coupon. */
export function financialAusteritySpending(
  spending: SpendingShape,
  revenue: number
): SpendingShape {
  const debtInterest = Math.max(0, spending.debtInterest);
  const primary = applyAusterityCap(
    { ...spending, debtInterest: 0, total: Math.max(0, spending.total - debtInterest) },
    Math.max(0, revenue - debtInterest)
  );
  return {
    byCategory: primary.scaledByCategory,
    stateGrants: primary.scaledStateGrants,
    debtInterest,
    total: primary.scaledTotal + debtInterest,
  };
}
