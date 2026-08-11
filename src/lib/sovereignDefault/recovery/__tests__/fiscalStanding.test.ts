import { describe, it, expect } from "vitest";
import { isInGoodFiscalStanding } from "../fiscalStanding";

describe("isInGoodFiscalStanding — primary surplus rule", () => {
  it("revenue >= spending - debtInterest is good standing", () => {
    expect(
      isInGoodFiscalStanding({
        revenueTotal: 500,
        spendingTotal: 600,
        spendingDebtInterest: 100,
      })
    ).toBe(true);
  });

  it("revenue < spending - debtInterest is bad standing", () => {
    expect(
      isInGoodFiscalStanding({
        revenueTotal: 400,
        spendingTotal: 600,
        spendingDebtInterest: 100,
      })
    ).toBe(false);
  });

  it("equal-to threshold (boundary) is good standing", () => {
    expect(
      isInGoodFiscalStanding({
        revenueTotal: 500,
        spendingTotal: 500,
        spendingDebtInterest: 0,
      })
    ).toBe(true);
  });

  it("NaN inputs return false (defensive)", () => {
    expect(
      isInGoodFiscalStanding({
        revenueTotal: Number.NaN,
        spendingTotal: 500,
        spendingDebtInterest: 100,
      })
    ).toBe(false);
  });

  it("zero spending and zero revenue is good standing (no obligations)", () => {
    expect(
      isInGoodFiscalStanding({
        revenueTotal: 0,
        spendingTotal: 0,
        spendingDebtInterest: 0,
      })
    ).toBe(true);
  });
});
