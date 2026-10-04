import { describe, expect, it } from "vitest";
import { sovereignClaimIncome, unbookedSovereignCouponIncome } from "./sovereignCouponIncome";

describe("sovereign coupon income rule", () => {
  it("counts coupon cash and never maturity principal", () => {
    expect(sovereignClaimIncome("coupon", 12.5)).toBe(12.5);
    expect(sovereignClaimIncome("maturity", 1000)).toBe(0);
    expect(sovereignClaimIncome("coupon", Number.NaN)).toBe(0);
    expect(sovereignClaimIncome("coupon", -3)).toBe(0);
  });

  it("books each coupon once whether it landed before or after the banking stamp", () => {
    // Treasury phase paid 10 before the pass: the stamp books it.
    let state = { sovereignCouponIncomeTotal: 10, sovereignCouponIncomeBooked: 0 };
    const stamped = unbookedSovereignCouponIncome(state);
    expect(stamped).toBe(10);
    state = { ...state, sovereignCouponIncomeBooked: 10 };
    // BondTurn pays 4 after the stamp: it stays pending, then the next stamp books it.
    state = { ...state, sovereignCouponIncomeTotal: 14 };
    expect(unbookedSovereignCouponIncome(state)).toBe(4);
    state = { ...state, sovereignCouponIncomeBooked: 14 };
    expect(unbookedSovereignCouponIncome(state)).toBe(0);
  });

  it("reads absent counters as zero", () => {
    expect(unbookedSovereignCouponIncome({})).toBe(0);
  });
});
