import { describe, expect, it } from "vitest";
import { summarizeEconomyMetrics } from "./metrics";

describe("summarizeEconomyMetrics", () => {
  it("uses household CPI rather than an unweighted commodity/base mean", () => {
    const result = summarizeEconomyMetrics(
      [
        { basePrice: 1, globalPrice: 8 },
        { basePrice: 1, globalPrice: 2 },
      ],
      [
        {
          gdp: 900,
          economicFactors: { householdPriceIndex: 1.2, inflationRate: 4 },
        },
        {
          gdp: 100,
          economicFactors: { householdPriceIndex: 1.4, inflationRate: 8 },
        },
      ]
    );

    expect(result.inflationIndex).toBeCloseTo(1.22);
    expect(result.inflationRate).toBeCloseTo(4.4);
    expect(result.commodityPriceLevelMean).toBe(5);
    expect(result.commodityPriceLevelMedian).toBe(5);
    expect(result.commodityPriceLevelP90).toBe(8);
    expect(result.inflationIndex).not.toBe(result.commodityPriceLevelMean);
  });

  it("falls back to equal country weights and reports missing household observations honestly", () => {
    const equalWeight = summarizeEconomyMetrics(
      [{ basePrice: 2, globalPrice: 3 }],
      [
        { economicFactors: { householdPriceIndex: 1.1, inflationRate: 2 } },
        { economicFactors: { householdPriceIndex: 1.3, inflationRate: 6 } },
      ]
    );
    expect(equalWeight.inflationIndex).toBeCloseTo(1.2);
    expect(equalWeight).toMatchObject({ inflationRate: 4, householdCpiCountries: 2 });

    expect(summarizeEconomyMetrics([], [])).toMatchObject({
      inflationIndex: 1,
      inflationRate: 0,
      householdCpiCountries: 0,
      commodityCount: 0,
    });
  });
});
