/**
 * Austerity cap — when sovereign IMF bailout is active, totalSpending must be
 * scaled down to fit within projected revenue. Phase 5 uses uniform proportional
 * scaling across all categories. Phase 9 will let the player choose specific
 * cuts; this helper stays as the fallback.
 */

export interface SpendingShape {
  byCategory: Record<string, number>;
  stateGrants: number;
  debtInterest: number;
  total: number;
}

export interface AusterityResult {
  scaledByCategory: Record<string, number>;
  scaledStateGrants: number;
  scaledDebtInterest: number;
  scaledTotal: number;
  scaleFactor: number;
}

export function applyAusterityCap(
  spending: SpendingShape,
  projectedRevenue: number
): AusterityResult {
  if (spending.total <= 0) {
    return {
      scaledByCategory: { ...spending.byCategory },
      scaledStateGrants: spending.stateGrants,
      scaledDebtInterest: spending.debtInterest,
      scaledTotal: spending.total,
      scaleFactor: 1,
    };
  }

  if (projectedRevenue >= spending.total) {
    return {
      scaledByCategory: { ...spending.byCategory },
      scaledStateGrants: spending.stateGrants,
      scaledDebtInterest: spending.debtInterest,
      scaledTotal: spending.total,
      scaleFactor: 1,
    };
  }

  const scaleFactor = Math.max(0, projectedRevenue / spending.total);
  const scaledByCategory: Record<string, number> = {};
  for (const [k, v] of Object.entries(spending.byCategory)) {
    scaledByCategory[k] = v * scaleFactor;
  }
  const scaledStateGrants = spending.stateGrants * scaleFactor;
  const scaledDebtInterest = spending.debtInterest * scaleFactor;
  const scaledTotal =
    Object.values(scaledByCategory).reduce((a, b) => a + b, 0) +
    scaledStateGrants +
    scaledDebtInterest;

  return {
    scaledByCategory,
    scaledStateGrants,
    scaledDebtInterest,
    scaledTotal,
    scaleFactor,
  };
}
