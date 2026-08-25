/**
 * Federal surplus (positive) or deficit (negative), derived from the budget's
 * own revenue and spending totals.
 *
 * `federalBudget.surplus` is a CACHE of this expression, not an independent
 * value. Every writer computes exactly `revenue.total - spending.total`, and
 * `federalBudgetSnapshots` confirms the two agree at every fiscal close. They
 * drift intra-year, so display surfaces derive rather than read the field.
 * `federalBudgetDetail.ts` already derived it, the Economy page did not, and
 * the two disagreed by up to 5% (US, turn 364).
 */
export interface SurplusInputs {
  revenue?: { total?: number } | null;
  spending?: { total?: number } | null;
}

const finite = (value: number | undefined): number =>
  typeof value === "number" && Number.isFinite(value) ? value : 0;

export function federalSurplus(budget: SurplusInputs): number {
  return finite(budget.revenue?.total) - finite(budget.spending?.total);
}
