import { describe, expect, it } from "vitest";
import { provisionalPriceVector } from "./provisionalPricing";

const profile = {
  baseCostFractionOfGdp: 0.00006,
  allocationFactors: [2.4, 1.4, 0.95, 0.55, 0.3],
};

describe("provisional replacement pricing", () => {
  it("preserves a source-funded center rather than replacing it with a tiny GDP proxy", () => {
    const result = provisionalPriceVector({
      gdp: 6_200_000_000_000,
      sourceAnnual: 117_262_305_000,
      profile,
    });
    expect(result).toMatchObject({
      anchor: "source-book",
      rawDesignCenterAnnual: 353_400_000,
      sourceAnnual: 117_262_305_000,
    });
    expect(result.fiveAnnualAllocations[2]).toBe(result.sourceAnnual);
    expect(result.fiveAnnualAllocations[0]).toBeGreaterThan(result.sourceAnnual);
    expect(result.fiveAnnualAllocations[4]).toBeLessThan(result.sourceAnnual);
  });

  it("uses the GDP proxy for an actually new program", () => {
    const result = provisionalPriceVector({ gdp: 6_200_000_000_000, sourceAnnual: 0, profile });
    expect(result.anchor).toBe("new-program-gdp-proxy");
    expect(result.fiveAnnualAllocations).toEqual([
      892_800_000, 520_800_000, 353_400_000, 204_600_000, 111_600_000,
    ]);
  });

  it("rejects malformed vectors and non-finite money", () => {
    expect(() => provisionalPriceVector({ gdp: Number.NaN, sourceAnnual: 0, profile })).toThrow();
    expect(() =>
      provisionalPriceVector({
        gdp: 1,
        sourceAnnual: 0,
        profile: { ...profile, allocationFactors: [1, 1, 0, 1, 1] },
      })
    ).toThrow("center factor");
  });
});
