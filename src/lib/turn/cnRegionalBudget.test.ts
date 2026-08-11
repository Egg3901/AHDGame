import { describe, it, expect } from "vitest";
import { calculateCNRegionalBudget } from "./cnRegionalBudget";

describe("calculateCNRegionalBudget", () => {
  it("calculates EIT share at standard 25% rate", () => {
    const result = calculateCNRegionalBudget({
      eitRate: 25,
      regionGdp: 42_000_000, // EAST region GDP in millions CNY
      regionPopulation: 385_000_000,
      nationalPopulation: 1_241_000_000,
      ministerAllocation: null,
    });
    // eitShare = 42_000_000 × 1_000_000 × 0.06 × 0.25 × 0.40 = 252_000_000_000
    expect(result.eitShare).toBeCloseTo(252_000_000_000, -3);
  });

  it("uses equal split when no minister allocation", () => {
    const result = calculateCNRegionalBudget({
      eitRate: 25,
      regionGdp: 42_000_000,
      regionPopulation: 385_000_000,
      nationalPopulation: 1_241_000_000,
      ministerAllocation: null,
    });
    // centralTransferGrant = 4000 × 1_241_000_000 / 7 ≈ 709_142_857_143
    expect(result.centralTransferGrant).toBeCloseTo(709_142_857_143, -6);
    expect(result.totalBudget).toBeCloseTo(result.eitShare + result.centralTransferGrant, 0);
  });

  it("uses minister allocation when provided", () => {
    const result = calculateCNRegionalBudget({
      eitRate: 25,
      regionGdp: 42_000_000,
      regionPopulation: 385_000_000,
      nationalPopulation: 1_241_000_000,
      ministerAllocation: 500_000_000_000,
    });
    expect(result.centralTransferGrant).toBe(500_000_000_000);
  });

  it("returns zero EIT share when rate is zero", () => {
    const result = calculateCNRegionalBudget({
      eitRate: 0,
      regionGdp: 42_000_000,
      regionPopulation: 385_000_000,
      nationalPopulation: 1_241_000_000,
      ministerAllocation: null,
    });
    expect(result.eitShare).toBe(0);
    expect(result.totalBudget).toBe(result.centralTransferGrant);
  });

  it("scales EIT share proportionally with region GDP", () => {
    const small = calculateCNRegionalBudget({
      eitRate: 25,
      regionGdp: 5_500_000, // NORTHEAST
      regionPopulation: 99_500_000,
      nationalPopulation: 1_241_000_000,
      ministerAllocation: null,
    });
    const large = calculateCNRegionalBudget({
      eitRate: 25,
      regionGdp: 42_000_000, // EAST
      regionPopulation: 385_000_000,
      nationalPopulation: 1_241_000_000,
      ministerAllocation: null,
    });
    expect(large.eitShare / small.eitShare).toBeCloseTo(42_000_000 / 5_500_000, 1);
  });

  it("computes Resource Tax revenue from region GDP × extraction proxy × rate", () => {
    const result = calculateCNRegionalBudget({
      eitRate: 0,
      regionGdp: 42_000_000,
      regionPopulation: 385_000_000,
      nationalPopulation: 1_241_000_000,
      ministerAllocation: 0,
      resourceTaxRate: 6, // statutory 6%
    });
    // resourceTaxRevenue = 42_000_000 × 1_000_000 × 0.03 × 0.06 = 75_600_000_000
    expect(result.resourceTaxRevenue).toBeCloseTo(75_600_000_000, -3);
    expect(result.totalBudget).toBeCloseTo(result.resourceTaxRevenue, 0);
  });

  it("returns zero Resource Tax when rate is undefined (region has not enacted the policy)", () => {
    const result = calculateCNRegionalBudget({
      eitRate: 0,
      regionGdp: 42_000_000,
      regionPopulation: 385_000_000,
      nationalPopulation: 1_241_000_000,
      ministerAllocation: 0,
    });
    expect(result.resourceTaxRevenue).toBe(0);
  });

  it("adds Resource Tax to total alongside EIT share and central transfer", () => {
    const result = calculateCNRegionalBudget({
      eitRate: 25,
      regionGdp: 42_000_000,
      regionPopulation: 385_000_000,
      nationalPopulation: 1_241_000_000,
      ministerAllocation: 500_000_000_000,
      resourceTaxRate: 12, // above-statutory Dual Carbon resource law
    });
    // eitShare 252_000_000_000 + centralTransfer 500_000_000_000 + resourceTax 151_200_000_000
    expect(result.totalBudget).toBeCloseTo(
      result.eitShare + result.centralTransferGrant + result.resourceTaxRevenue,
      0
    );
    expect(result.resourceTaxRevenue).toBeCloseTo(42_000_000 * 1_000_000 * 0.03 * 0.12, -3);
  });

  it("collects a standing Business Tax (营业税) from regional GDP", () => {
    const result = calculateCNRegionalBudget(
      {
        eitRate: 0,
        regionGdp: 1_000_000, // 1,000,000 million CNY
        regionPopulation: 1_000_000,
        nationalPopulation: 7_000_000,
        ministerAllocation: 0,
      },
      {
        localTaxRetentionShare: 0.4,
        corporateProfitRatio: 0.06,
        centralTransferPerCapita: 35,
        regionCount: 7,
        resourceExtractionRatio: 0,
        businessTaxConsumptionRatio: 0.5,
        businessTaxRate: 24,
      }
    );
    // 1_000_000 × 1_000_000 × 0.5 × 0.24 = 120_000_000_000
    expect(result.businessTaxRevenue).toBe(120_000_000_000);
    expect(result.totalBudget).toBeCloseTo(result.businessTaxRevenue, 2);
  });
});
