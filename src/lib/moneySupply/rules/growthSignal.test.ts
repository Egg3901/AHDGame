import { describe, expect, it } from "vitest";
import { currentMoneyGrowth } from "./growthSignal";

describe("comparable money-growth signal", () => {
  it.each([undefined, 1, 3])("rejects a different accounting version %s", (accountingVersion) => {
    expect(currentMoneyGrowth({ accountingVersion, annualizedM2GrowthPct: 100 })).toBeNull();
  });
  it("preserves warmup and missing observations while accepting actual zero growth", () => {
    expect(currentMoneyGrowth(null)).toBeNull();
    expect(currentMoneyGrowth({ accountingVersion: 2, annualizedM2GrowthPct: null })).toBeNull();
    expect(currentMoneyGrowth({ accountingVersion: 2, annualizedM2GrowthPct: 0 })).toBe(0);
  });
});
