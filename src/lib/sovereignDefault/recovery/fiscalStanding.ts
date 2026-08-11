/**
 * Recovery fiscal-discipline check (design 5.7).
 *
 * Phase 8 ships the primary-surplus branch only: revenue >= non-interest
 * spending. The design's stable/declining-D/GDP-over-5-turns OR-branch is
 * deferred to Phase 10 calibration — primary surplus is sufficient for the
 * "either condition qualifies" rule.
 */

export interface FiscalStandingInputs {
  revenueTotal: number;
  spendingTotal: number;
  spendingDebtInterest: number;
}

export function isInGoodFiscalStanding(inputs: FiscalStandingInputs): boolean {
  if (
    !Number.isFinite(inputs.revenueTotal) ||
    !Number.isFinite(inputs.spendingTotal) ||
    !Number.isFinite(inputs.spendingDebtInterest)
  ) {
    return false;
  }
  const nonInterestSpending = inputs.spendingTotal - inputs.spendingDebtInterest;
  return inputs.revenueTotal >= nonInterestSpending;
}
