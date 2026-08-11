import { describe, expect, it } from "vitest";
import { calculatePolicyOptionAnnualCost } from "./costs";
import { LEGISLATION_COST_CLASS } from "@/lib/era/legislationCostCatalog";
import { getIncomeAnchor } from "@/lib/era/metricCatalog";
import type { LegislationPolicyOption } from "@/lib/db/types/legislation";

const ctx = (year?: number | null, nationalMedianIncome?: number) => ({
  budgetCapacity: 0,
  gdp: 20_000_000,
  population: 100,
  countryId: "US",
  year,
  nationalMedianIncome,
});

describe("costs.ts era-B gate", () => {
  it("flag off (year null): legacy annualCostPerCapita path, ignores era field", () => {
    LEGISLATION_COST_CLASS.eraB_gdp_type = "gdpFraction";
    const legacy = calculatePolicyOptionAnnualCost(
      { annualCostPerCapita: 500, gdpCostFraction: 0.99 } as LegislationPolicyOption,
      ctx(null),
      "eraB_gdp_type"
    );
    // Legacy = annualCostPerCapita × population × scale (>0), NOT 0.99 × GDP.
    expect(legacy).toBeGreaterThan(0);
    expect(legacy).not.toBeCloseTo(0.99 * 20_000_000);
  });

  it("flag on: gdpFraction type uses gdpCostFraction × GDP, ignores legacy field", () => {
    LEGISLATION_COST_CLASS.eraB_gdp_type = "gdpFraction";
    const cost = calculatePolicyOptionAnnualCost(
      { annualCostPerCapita: 999999, gdpCostFraction: 0.03 } as LegislationPolicyOption,
      ctx(2019),
      "eraB_gdp_type"
    );
    expect(cost).toBeCloseTo(0.03 * 20_000_000);
  });

  it("flag on: none-class type returns 0 (budget-neutral)", () => {
    LEGISLATION_COST_CLASS.eraB_none_type = "none";
    const cost = calculatePolicyOptionAnnualCost(
      { annualCostPerCapita: 500 } as LegislationPolicyOption,
      ctx(2019),
      "eraB_none_type"
    );
    expect(cost).toBe(0);
  });

  it("flag on but no typeId: falls back to legacy (safe for un-threaded callers)", () => {
    const cost = calculatePolicyOptionAnnualCost(
      { annualCostPerCapita: 500 } as LegislationPolicyOption,
      ctx(2019)
    );
    expect(cost).toBeGreaterThan(0);
  });
});

describe("costs.ts era-B perCapita: game-native income base", () => {
  it("flag on: perCapita pins to the calibrated share of GDP, not the live income base (#3149)", () => {
    LEGISLATION_COST_CLASS.eraB_pc_type = "perCapita";
    // A low live median income used to scale the charge DOWN (frac × income × pop),
    // suppressing every perCapita law in JP/NG. The charge is now frac × i2g × gdp
    // (the calibrated share of GDP) regardless of the live income.
    const i2gUS = (getIncomeAnchor("US", 2019)! * 333_000_000) / 27_000_000_000_000;
    const cost = calculatePolicyOptionAnnualCost(
      { incomeCostFraction: 0.02 } as LegislationPolicyOption,
      ctx(2019, 40_000),
      "eraB_pc_type"
    );
    expect(cost).toBeCloseTo(0.02 * i2gUS * 20_000_000);
    expect(cost).not.toBeCloseTo(0.02 * 40_000 * 100); // retired income-scaling form
  });

  it("flag on, no game income: falls back to share-of-GDP via incomeToGdp, NOT the era anchor", () => {
    LEGISLATION_COST_CLASS.eraB_pc_type = "perCapita";
    const cost = calculatePolicyOptionAnnualCost(
      { incomeCostFraction: 0.02 } as LegislationPolicyOption,
      ctx(2019),
      "eraB_pc_type"
    );
    // Fallback = fraction × incomeToGdp(US) × gdp, where incomeToGdp(US) =
    // getIncomeAnchor("US", 2019) × 333_000_000 / 27_000_000_000_000 (REP_ECON).
    const i2gUS = (getIncomeAnchor("US", 2019)! * 333_000_000) / 27_000_000_000_000;
    expect(cost).toBeCloseTo(0.02 * i2gUS * 20_000_000);
    // And it must NOT be the retired charge-time era-anchor form:
    const oldPath = 0.02 * getIncomeAnchor("US", 2019)! * 100;
    expect(cost).not.toBeCloseTo(oldPath);
  });

  it("flag on, unknown country, no income: fallback uses the 0.8 default ratio", () => {
    LEGISLATION_COST_CLASS.eraB_pc_type = "perCapita";
    const cost = calculatePolicyOptionAnnualCost(
      { incomeCostFraction: 0.02 } as LegislationPolicyOption,
      { ...ctx(2019), countryId: "ZZ" },
      "eraB_pc_type"
    );
    expect(cost).toBeCloseTo(0.02 * 0.8 * 20_000_000);
  });

  it("flag on: non-finite game income is treated as absent (fallback, not NaN)", () => {
    LEGISLATION_COST_CLASS.eraB_pc_type = "perCapita";
    const cost = calculatePolicyOptionAnnualCost(
      { incomeCostFraction: 0.02 } as LegislationPolicyOption,
      ctx(2019, Number.NaN),
      "eraB_pc_type"
    );
    expect(Number.isFinite(cost)).toBe(true);
    expect(cost).toBeGreaterThan(0);
  });
});
