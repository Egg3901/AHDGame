import { describe, expect, it } from "vitest";
import { quoteLoanOrigination } from "./loanFees";

describe("loan origination fees", () => {
  it("withholds one percent and conserves funded cash", () => {
    expect(quoteLoanOrigination(100_000, "USD")).toEqual({
      principal: 100_000,
      originationFee: 1_000,
      proceeds: 99_000,
    });
  });

  it("rounds to the loan currency and never exceeds principal", () => {
    expect(quoteLoanOrigination(12.34, "USD").originationFee).toBe(0.12);
    expect(quoteLoanOrigination(12.34, "JPY").originationFee).toBe(0);
    expect(quoteLoanOrigination(0.01, "USD").proceeds).toBe(0.01);
  });

  it("honors a legacy zero-fee request and bounds a persisted quote", () => {
    expect(quoteLoanOrigination(100, "USD", 0).proceeds).toBe(100);
    expect(quoteLoanOrigination(100, "USD", 90).originationFee).toBe(1);
    expect(quoteLoanOrigination(100, "USD", Number.NaN).originationFee).toBe(0);
  });

  it("does not charge invalid or negative advances", () => {
    for (const value of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(quoteLoanOrigination(value, "USD")).toEqual({
        principal: 0,
        originationFee: 0,
        proceeds: 0,
      });
    }
  });
});
