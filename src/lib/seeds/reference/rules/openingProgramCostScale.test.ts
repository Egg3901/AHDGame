import { describe, expect, it } from "vitest";
import {
  openingProgramCategoryScales,
  openingProgramCostScale,
  scaleProgramCostModel,
} from "./openingProgramCostScale";

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
  it("refits an era-mispriced book to the authored composition from either side", () => {
    const input = {
      gdp: 1000,
      annualRevenue: 300,
      annualDebtService: 20,
      fixedOperatingCost: 30,
      programCostByCategory: { health: 5, defense: 80, other: 15, empty: 0 },
      targetByCategory: { health: 100, defense: 50, other: 60, localGovernment: 40 },
      maximumDeficitGdpShare: 0.005,
    };
    const scales = openingProgramCategoryScales(input);
    // Affordable programs: 300 + 5 - 20 - 30 = 255 against a 250 authored book.
    expect(scales.health).toBeCloseTo((100 * 1.02) / 5, 10);
    expect(scales.defense).toBeCloseTo((50 * 1.02) / 80, 10);
    expect(scales.other).toBeCloseTo((100 * 1.02) / 15, 10);
    expect(scales).not.toHaveProperty("empty");
    const fitted = 5 * scales.health! + 80 * scales.defense! + 15 * scales.other! + 20 + 30 - 300;
    expect(fitted).toBeCloseTo(5, 6);
    // Too generous an authored book shrinks to the same deficit envelope.
    const shrunk = openingProgramCategoryScales({ ...input, annualRevenue: 150 });
    expect(5 * shrunk.health! + 80 * shrunk.defense! + 15 * shrunk.other! + 50 - 150).toBeCloseTo(
      5,
      6
    );
  });
  it("keeps unauthored categories at their priced share and never funds below zero", () => {
    const scales = openingProgramCategoryScales({
      gdp: 1000,
      annualRevenue: 100,
      annualDebtService: 200,
      fixedOperatingCost: 0,
      programCostByCategory: { transport: 10 },
      targetByCategory: { health: 40 },
      maximumDeficitGdpShare: 0.005,
    });
    expect(scales).toEqual({ transport: 0 });
  });
});
