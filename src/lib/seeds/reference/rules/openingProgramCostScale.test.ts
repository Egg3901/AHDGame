import { describe, expect, it } from "vitest";
import { openingProgramCostScale, scaleProgramCostModel } from "./openingProgramCostScale";

describe("authoritative opening program costs", () => {
  it("funds coupons and actual regional transfers before scaling the policy ladder", () => {
    const scale = openingProgramCostScale({
      gdp: 1000,
      annualRevenue: 250,
      annualDebtService: 50,
      fixedOperatingCost: 25,
      programCost: 250,
      maximumDeficitGdpShare: 0.005,
    });
    expect(scale).toBe(0.72);
    expect(250 * scale + 50 + 25 - 250).toBe(5);
  });
  it("keeps affordable programs and never forces negative funding", () => {
    const base = {
      gdp: 1000,
      annualRevenue: 200,
      annualDebtService: 20,
      fixedOperatingCost: 10,
      programCost: 100,
      maximumDeficitGdpShare: 0.005,
    };
    expect(openingProgramCostScale(base)).toBe(1);
    expect(openingProgramCostScale({ ...base, programCost: 0 })).toBe(1);
    expect(openingProgramCostScale({ ...base, annualDebtService: 500 })).toBe(0);
  });
  it("preserves all receipt fractions and level relationships without mutating models", () => {
    const model = { gdpCostFraction: 0.1, incomeCostFraction: 0.2, gdpRevenueFraction: 0.03 };
    expect(scaleProgramCostModel(model, 0.5)).toEqual({
      gdpCostFraction: 0.05,
      incomeCostFraction: 0.1,
      gdpRevenueFraction: 0.03,
    });
    expect(model.gdpCostFraction).toBe(0.1);
    expect(scaleProgramCostModel({ gdpRevenueFraction: 0.02 }, 0.5)).toEqual({
      gdpRevenueFraction: 0.02,
    });
  });
});
