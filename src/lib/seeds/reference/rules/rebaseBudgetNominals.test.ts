import { describe, expect, it } from "vitest";
import { rebaseBudgetNominals } from "./rebaseBudgetNominals";

const source = {
  gdp: 1800,
  otherRevenue: 120,
  debt: { principal: 400, ceiling: 600, interestRate: 0.18 },
  baselineSpendingByCategory: { education: 25, defense: 40 },
  baselineStateGrants: 20,
  taxBaseRatios: { taxableIncome: 0.03 },
  economicFactors: { inflationRate: 20 },
};
describe("Seed budget nominal rebasing", () => {
  it("preserves all existing fiscal shares and independent policy rates without mutating the source", () => {
    const next = rebaseBudgetNominals(source, 590);
    expect(next.otherRevenue / next.gdp).toBeCloseTo(120 / 1800);
    expect(next.debt.principal / next.gdp).toBeCloseTo(400 / 1800);
    expect(next.debt.ceiling / next.gdp).toBeCloseTo(600 / 1800);
    expect(next.baselineSpendingByCategory.education / next.gdp).toBeCloseTo(25 / 1800);
    expect(next.baselineSpendingByCategory.defense / next.gdp).toBeCloseTo(40 / 1800);
    expect(next.baselineStateGrants / next.gdp).toBeCloseTo(20 / 1800);
    expect(next.debt.interestRate).toBe(0.18);
    expect(next.taxBaseRatios).toEqual(source.taxBaseRatios);
    expect(next.economicFactors).toEqual(source.economicFactors);
    expect(source.debt.principal).toBe(400);
    expect(source.gdp).toBe(1800);
  });
  it("is idempotent after rebasing", () => {
    const next = rebaseBudgetNominals(source, 590);
    expect(rebaseBudgetNominals(next, 590)).toEqual(next);
  });
  it.each([0, -1, NaN, Infinity])("rejects invalid GDP %s", (gdp) => {
    expect(() => rebaseBudgetNominals(source, gdp)).toThrow("Positive finite GDP");
    expect(() => rebaseBudgetNominals({ ...source, gdp }, 590)).toThrow("Positive finite GDP");
  });
});
