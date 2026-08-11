import { describe, it, expect } from "vitest";
import {
  getPopulationTier,
  getFundGenerationRate,
  getDonorBaseBonus,
  calculateTaxAmount,
  logarithmicPopulationScale,
  getDonorBaseBonusLogarithmic,
  diminishingReturnsMultiplier,
  calculateNppFundGeneration,
  getGdpBaseline,
  getIncomeGdpScalar,
} from "./fundGeneration";

describe("getGdpBaseline (per-country GDP-per-capita baseline)", () => {
  it("returns the calibrated baseline for configured currencies", () => {
    expect(getGdpBaseline("US")).toBe(65_000);
    expect(getGdpBaseline("UK")).toBe(30_000);
  });

  it("uses a naira-scaled baseline for NG, not the USD default", () => {
    // NG state GDP is stored in naira-millions, so its per-capita (~₦1.5M–4.4M)
    // must be measured against a naira baseline. Falling through to the 65_000
    // USD default pinned every NG region at the scaling ceilings.
    const baseline = getGdpBaseline("NG");
    expect(baseline).toBeGreaterThan(1_000_000);
    expect(baseline).not.toBe(65_000);
  });

  it("keeps a representative NG region off the income ceiling", () => {
    // South-South: gdp ₦58.87B (naira-millions), pop 13.39M → per-capita ~₦4.4M.
    // With the naira baseline this scales below the 1.5 income ceiling.
    const scalar = getIncomeGdpScalar(58_873_063, 13_392_943, "NG");
    expect(scalar).toBeLessThan(1.5);
    expect(scalar).toBeGreaterThan(0.9);
  });

  it("keeps a poorer NG region near the income floor", () => {
    // North-West: per-capita ~₦1.5M → below the naira baseline → floors at 0.9.
    const scalar = getIncomeGdpScalar(35_436_460, 22_913_412, "NG");
    expect(scalar).toBeCloseTo(0.9, 5);
  });
});

describe("getPopulationTier", () => {
  it("returns small for < 2M", () => {
    expect(getPopulationTier(1_000_000)).toBe("small");
    expect(getPopulationTier(1_999_999)).toBe("small");
  });

  it("returns medium for 2M–8M", () => {
    expect(getPopulationTier(2_000_000)).toBe("medium");
    expect(getPopulationTier(5_000_000)).toBe("medium");
    expect(getPopulationTier(7_999_999)).toBe("medium");
  });

  it("returns large for 8M–20M", () => {
    expect(getPopulationTier(8_000_000)).toBe("large");
    expect(getPopulationTier(15_000_000)).toBe("large");
    expect(getPopulationTier(19_999_999)).toBe("large");
  });

  it("returns mega for >= 20M", () => {
    expect(getPopulationTier(20_000_000)).toBe("mega");
    expect(getPopulationTier(40_000_000)).toBe("mega");
  });
});

describe("getFundGenerationRate", () => {
  it("returns correct rates per tier", () => {
    expect(getFundGenerationRate(1_000_000)).toBe(5_000);
    expect(getFundGenerationRate(5_000_000)).toBe(10_000);
    expect(getFundGenerationRate(15_000_000)).toBe(20_000);
    expect(getFundGenerationRate(25_000_000)).toBe(40_000);
  });
});

describe("getDonorBaseBonus", () => {
  it("returns 0 for donorBaseLevel <= 0", () => {
    expect(getDonorBaseBonus(0, 5_000_000)).toBe(0);
    expect(getDonorBaseBonus(-1, 5_000_000)).toBe(0);
  });

  it("returns tier-scaled bonus", () => {
    expect(getDonorBaseBonus(1, 1_000_000)).toBe(100);
    expect(getDonorBaseBonus(2, 5_000_000)).toBe(400);
  });
});

describe("calculateTaxAmount", () => {
  it("returns 0 for taxRate <= 0", () => {
    expect(calculateTaxAmount(1000, 0)).toBe(0);
    expect(calculateTaxAmount(1000, -5)).toBe(0);
  });

  it("calculates correct tax", () => {
    expect(calculateTaxAmount(1000, 10)).toBe(100);
    expect(calculateTaxAmount(5000, 33)).toBe(1650);
  });

  it("floors result", () => {
    expect(calculateTaxAmount(100, 33)).toBe(33);
  });
});

describe("logarithmicPopulationScale", () => {
  it("returns ~$4,000 for Wyoming (580K population)", () => {
    const result = logarithmicPopulationScale(580_000);
    expect(result).toBeGreaterThan(3_500);
    expect(result).toBeLessThan(4_500);
  });

  it("returns ~$10,000 for Nevada (3.1M population)", () => {
    const result = logarithmicPopulationScale(3_100_000);
    expect(result).toBeGreaterThan(9_000);
    expect(result).toBeLessThan(11_000);
  });

  it("returns ~$15,000 for Ohio (11.8M population)", () => {
    const result = logarithmicPopulationScale(11_800_000);
    expect(result).toBeGreaterThan(13_000);
    expect(result).toBeLessThan(17_000);
  });

  it("returns ~$19,000 for California (39M population)", () => {
    const result = logarithmicPopulationScale(39_000_000);
    expect(result).toBeGreaterThan(17_000);
    expect(result).toBeLessThan(21_000);
  });

  it("compresses California/Wyoming ratio to ~4.7x", () => {
    const wyoming = logarithmicPopulationScale(580_000);
    const california = logarithmicPopulationScale(39_000_000);
    const ratio = california / wyoming;
    expect(ratio).toBeGreaterThan(4);
    expect(ratio).toBeLessThan(5.5);
  });
});

describe("getDonorBaseBonusLogarithmic", () => {
  it("level 5 doubles base income", () => {
    const population = 3_000_000;
    const base = logarithmicPopulationScale(population);
    const withL5 = base + getDonorBaseBonusLogarithmic(5, population);
    expect(withL5 / base).toBeCloseTo(2, 0.2);
  });
});

describe("diminishingReturnsMultiplier", () => {
  it("returns 1.0 for funds $0-$50K", () => {
    expect(diminishingReturnsMultiplier(0)).toBe(1.0);
    expect(diminishingReturnsMultiplier(25_000)).toBe(1.0);
    expect(diminishingReturnsMultiplier(50_000)).toBe(1.0);
  });

  it("returns 0.75 for funds $50K-$150K", () => {
    expect(diminishingReturnsMultiplier(50_001)).toBe(0.75);
    expect(diminishingReturnsMultiplier(100_000)).toBe(0.75);
    expect(diminishingReturnsMultiplier(150_000)).toBe(0.75);
  });

  it("returns 0.5 for funds $150K-$300K", () => {
    expect(diminishingReturnsMultiplier(150_001)).toBe(0.5);
    expect(diminishingReturnsMultiplier(200_000)).toBe(0.5);
    expect(diminishingReturnsMultiplier(300_000)).toBe(0.5);
  });

  it("returns 0.25 for funds above $300K", () => {
    expect(diminishingReturnsMultiplier(300_001)).toBe(0.25);
    expect(diminishingReturnsMultiplier(500_000)).toBe(0.25);
  });
});

describe("calculateNppFundGeneration", () => {
  it("returns 50% of player rate", () => {
    const population = 3_000_000;
    const playerRate = logarithmicPopulationScale(population);
    const nppRate = calculateNppFundGeneration(population, 0, 0);
    // Allow small rounding difference
    expect(nppRate).toBeGreaterThan(playerRate * 0.45);
    expect(nppRate).toBeLessThan(playerRate * 0.55);
  });

  it("applies diminishing returns", () => {
    const population = 3_000_000;
    const baseNpp = calculateNppFundGeneration(population, 0, 0);
    const withFunds = calculateNppFundGeneration(population, 0, 200_000);
    // At $200K, should be 50% efficiency
    expect(withFunds).toBeLessThan(baseNpp);
    expect(withFunds).toBeGreaterThan(baseNpp * 0.4);
    expect(withFunds).toBeLessThan(baseNpp * 0.6);
  });

  it("includes donor base bonus at 50%", () => {
    const population = 3_000_000;
    const l0 = calculateNppFundGeneration(population, 0, 0);
    const l5 = calculateNppFundGeneration(population, 5, 0);
    // L5 should roughly double income (2x, allowing tolerance)
    expect(l5 / l0).toBeGreaterThan(1.8);
    expect(l5 / l0).toBeLessThan(2.2);
  });
});
