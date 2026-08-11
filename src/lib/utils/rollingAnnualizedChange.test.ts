import { describe, expect, it } from "vitest";

import { computeRollingAnnualizedPercentChange } from "./rollingAnnualizedChange";

describe("computeRollingAnnualizedPercentChange", () => {
  it("returns 0 without a usable reference value", () => {
    expect(
      computeRollingAnnualizedPercentChange({
        currentValue: 120,
        referenceValue: null,
        turnSpan: 48,
      })
    ).toBe(0);
  });

  it("returns raw percent change when history is shorter than half a year", () => {
    expect(
      computeRollingAnnualizedPercentChange({
        currentValue: 120,
        referenceValue: 100,
        turnSpan: 12,
      })
    ).toBe(20);
  });

  it("annualizes percent change when enough turn history exists", () => {
    expect(
      computeRollingAnnualizedPercentChange({
        currentValue: 120,
        referenceValue: 100,
        turnSpan: 24,
      })
    ).toBe(40);
  });

  it("handles losses and rounds to two decimals", () => {
    expect(
      computeRollingAnnualizedPercentChange({
        currentValue: 95,
        referenceValue: 123,
        turnSpan: 48,
      })
    ).toBe(-22.76);
  });
});
