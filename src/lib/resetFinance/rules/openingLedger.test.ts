import { describe, expect, it } from "vitest";
import { bridgeOpeningLedger } from "./openingLedger";

describe("reset opening fiscal bridge", () => {
  const source = {
    revenue: 100,
    spendingIncludingInterest: 90,
    gdp: 500,
    debt: 100,
    annualInterestRate: 0.05,
  };

  it("keeps interest separate and applies each named source correction once", () => {
    expect(
      bridgeOpeningLedger(source, [
        { id: "old_future_law", revenueDelta: 0, spendingDelta: -10, reason: "not active" },
        { id: "tax_base", revenueDelta: 2, spendingDelta: 0, reason: "selected tax rate" },
      ])
    ).toMatchObject({ revenue: 102, operating: 75, interest: 5, annualBalance: 22 });
  });

  it("rejects duplicate and impossible corrections", () => {
    const correction = { id: "law", revenueDelta: 0, spendingDelta: -10, reason: "not active" };
    expect(() => bridgeOpeningLedger(source, [correction, correction])).toThrow();
    expect(() =>
      bridgeOpeningLedger(source, [
        { id: "all_spending", revenueDelta: 0, spendingDelta: -100, reason: "invalid" },
      ])
    ).toThrow();
  });
});
