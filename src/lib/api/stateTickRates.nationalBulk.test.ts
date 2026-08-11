import { describe, it, expect } from "vitest";
import { aggregateNationalTickRates } from "./stateTickRates";

describe("aggregateNationalTickRates", () => {
  it("population-weights non-GDP metrics", () => {
    const result = aggregateNationalTickRates([
      {
        population: 3_000_000,
        gdp: 100,
        hasSectors: true,
        tickRates: { economic: { unemploymentRate: 0.2 } },
      },
      {
        population: 1_000_000,
        gdp: 100,
        hasSectors: true,
        tickRates: { economic: { unemploymentRate: 0.6 } },
      },
    ]);
    // (0.2*3 + 0.6*1) / 4 = 0.3
    expect(result.economic.unemploymentRate).toBeCloseTo(0.3, 6);
  });

  it("gdp-weights economic.gdpGrowth and ignores sector-less states", () => {
    const result = aggregateNationalTickRates([
      {
        population: 1_000_000,
        gdp: 900,
        hasSectors: true,
        tickRates: { economic: { gdpGrowth: 0.1 } },
      },
      {
        population: 9_000_000,
        gdp: 100,
        hasSectors: false,
        tickRates: { economic: { gdpGrowth: 0.9 } },
      },
    ]);
    // sector-less state excluded; only first contributes → 0.1
    expect(result.economic.gdpGrowth).toBeCloseTo(0.1, 6);
  });

  it("omits a metric when total weight is zero", () => {
    const result = aggregateNationalTickRates([
      { population: 0, gdp: 0, hasSectors: false, tickRates: { social: { socialMobility: 0.5 } } },
    ]);
    expect(result.social?.socialMobility).toBeUndefined();
  });

  it("returns an empty object for no states", () => {
    expect(aggregateNationalTickRates([])).toEqual({});
  });
});
