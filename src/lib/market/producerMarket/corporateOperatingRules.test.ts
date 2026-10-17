import { describe, expect, it } from "vitest";
import { apportionOperatingProfit } from "./corporateOperatingRules";

describe("receipt-based corporate operating profit", () => {
  it("includes the fixed-cost loss of a site that made no sales", () => {
    const result = apportionOperatingProfit({
      sectors: [
        { revenue: 1000, operatingCosts: 500 },
        { revenue: 0, operatingCosts: 600 },
      ],
      corporateCosts: 0,
    });
    expect(result).toEqual([
      { operatingProfit: 500, profitAfterCorporateCosts: 500, taxableProfit: 0 },
      { operatingProfit: -600, profitAfterCorporateCosts: -600, taxableProfit: 0 },
    ]);
  });
  it("offsets losses while retaining the profitable site's tax jurisdiction", () => {
    const result = apportionOperatingProfit({
      sectors: [
        { revenue: 1000, operatingCosts: 500 },
        { revenue: 0, operatingCosts: 200 },
      ],
      corporateCosts: 100,
    });
    expect(result.map((s) => s.taxableProfit)).toEqual([200, 0]);
    expect(result.reduce((sum, s) => sum + s.profitAfterCorporateCosts, 0)).toBe(200);
  });
  it("retains all overhead when every site has zero revenue", () => {
    const result = apportionOperatingProfit({
      sectors: [
        { revenue: 0, operatingCosts: 10 },
        { revenue: 0, operatingCosts: 20 },
      ],
      corporateCosts: 30,
    });
    expect(result.map((s) => s.profitAfterCorporateCosts)).toEqual([-25, -35]);
    expect(result.map((s) => s.taxableProfit)).toEqual([0, 0]);
  });
});
