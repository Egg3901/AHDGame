/**
 * Realized sovereign coupon income for a bank charter epoch.
 *
 * A funded coupon credits the vault in the same atomic write that raises a
 * cumulative `sovereignCouponIncomeTotal` on that charter epoch. The banking
 * pass books whatever has accrued since its last stamp, so a coupon paid before
 * the pass (Treasury phase) and one paid after it (BondTurn phase) both reach
 * the earnings line exactly once. Maturity principal never feeds the counter.
 */

export interface SovereignCouponIncomeState {
  sovereignCouponIncomeTotal?: number;
  sovereignCouponIncomeBooked?: number;
}

/** Cash a funded claim adds to the cumulative income counter. Principal is not income. */
export function sovereignClaimIncome(kind: "coupon" | "maturity", amountLocal: number): number {
  if (kind !== "coupon") return 0;
  return Number.isFinite(amountLocal) && amountLocal > 0 ? amountLocal : 0;
}

/** Coupon cash paid to the epoch that no banking stamp has booked yet. */
export function unbookedSovereignCouponIncome(state: SovereignCouponIncomeState): number {
  const total = state.sovereignCouponIncomeTotal ?? 0;
  const booked = state.sovereignCouponIncomeBooked ?? 0;
  if (!Number.isFinite(total) || !Number.isFinite(booked)) return 0;
  return Math.max(0, total - booked);
}
