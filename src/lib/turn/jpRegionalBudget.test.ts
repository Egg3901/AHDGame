import { describe, it, expect } from "vitest";
import { calculateJPRegionalBudget } from "./jpRegionalBudget";

describe("calculateJPRegionalBudget", () => {
  const baseInput = {
    residentTaxRate: 0.1, // 10% center rate
    fixedAssetTaxRate: 0.014, // 1.4% center rate
    nationalGrantPerCapita: 170000, // ¥170,000/cap center
    regionPopulation: 5200000, // Hokkaido: 5.2M
    medianIncome: 3500000, // ¥3.5M median
    propertyValueBase: 8000000, // ¥8M avg property value
    nationalPopulation: 126000000, // 126M total
    ministerAllocation: null,
  };

  it("calculates resident tax revenue correctly", () => {
    const result = calculateJPRegionalBudget(baseInput);
    // residentTaxRate × medianIncome × population
    expect(result.residentTaxRevenue).toBe(0.1 * 3500000 * 5200000);
  });

  it("calculates fixed asset tax revenue correctly", () => {
    const result = calculateJPRegionalBudget(baseInput);
    // fixedAssetTaxRate × propertyValueBase × population
    expect(result.fixedAssetTaxRevenue).toBe(0.014 * 8000000 * 5200000);
  });

  it("calculates national grant with even 1/8th split when no minister allocation", () => {
    const result = calculateJPRegionalBudget(baseInput);
    // nationalGrantPerCapita × nationalPopulation / 8 regions
    expect(result.nationalGrant).toBe((170000 * 126000000) / 8);
  });

  it("uses minister allocation when provided", () => {
    const result = calculateJPRegionalBudget({
      ...baseInput,
      ministerAllocation: 5000000000000, // ¥5T allocated to this region
    });
    expect(result.nationalGrant).toBe(5000000000000);
  });

  it("total budget sums all three revenue sources", () => {
    const result = calculateJPRegionalBudget(baseInput);
    expect(result.totalBudget).toBe(
      result.residentTaxRevenue + result.fixedAssetTaxRevenue + result.nationalGrant
    );
  });

  it("handles zero tax rates", () => {
    const result = calculateJPRegionalBudget({
      ...baseInput,
      residentTaxRate: 0,
      fixedAssetTaxRate: 0,
    });
    expect(result.residentTaxRevenue).toBe(0);
    expect(result.fixedAssetTaxRevenue).toBe(0);
    expect(result.totalBudget).toBe(result.nationalGrant);
  });

  it("handles zero national grant", () => {
    const result = calculateJPRegionalBudget({
      ...baseInput,
      nationalGrantPerCapita: 0,
    });
    expect(result.nationalGrant).toBe(0);
    expect(result.totalBudget).toBe(result.residentTaxRevenue + result.fixedAssetTaxRevenue);
  });

  it("handles maximum tax rates", () => {
    const result = calculateJPRegionalBudget({
      ...baseInput,
      residentTaxRate: 0.2, // 20% max
      fixedAssetTaxRate: 0.05, // 5% max
    });
    expect(result.residentTaxRevenue).toBe(0.2 * 3500000 * 5200000);
    expect(result.fixedAssetTaxRevenue).toBe(0.05 * 8000000 * 5200000);
  });
});
