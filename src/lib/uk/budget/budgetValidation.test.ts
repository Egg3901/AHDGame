import { describe, it, expect } from "vitest";
import {
  validateSpendingAllocations,
  validateTaxRates,
  validateBudget,
  UK_TAX_LEVER_IDS,
} from "./budgetValidation";

describe("UK_TAX_LEVER_IDS", () => {
  it("includes real UK tax levers", () => {
    expect(UK_TAX_LEVER_IDS.has("uk.tax.incomeTax")).toBe(true);
    expect(UK_TAX_LEVER_IDS.size).toBeGreaterThan(0);
  });
});

describe("validateSpendingAllocations", () => {
  it("accepts known categories summing to 100", () => {
    expect(validateSpendingAllocations({ healthcare: 40, defense: 30, education: 30 }).ok).toBe(
      true
    );
  });
  it("allows a small rounding tolerance", () => {
    expect(validateSpendingAllocations({ healthcare: 50, defense: 49.7 }).ok).toBe(true);
  });
  it("rejects an unknown category", () => {
    const r = validateSpendingAllocations({ healthcare: 50, spaceForce: 50 });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("spaceForce");
  });
  it("rejects shares that don't sum to 100", () => {
    expect(validateSpendingAllocations({ healthcare: 40, defense: 30 }).ok).toBe(false);
  });
  it("rejects negative shares", () => {
    expect(validateSpendingAllocations({ healthcare: 120, defense: -20 }).ok).toBe(false);
  });
});

describe("validateTaxRates", () => {
  it("accepts real levers within range", () => {
    expect(validateTaxRates({ "uk.tax.incomeTax": 25, "uk.tax.salesTax": 20 }).ok).toBe(true);
  });
  it("rejects an unknown lever", () => {
    expect(validateTaxRates({ "uk.tax.wealthTax": 5 }).ok).toBe(false);
  });
  it("rejects out-of-range rates", () => {
    expect(validateTaxRates({ "uk.tax.incomeTax": -1 }).ok).toBe(false);
    expect(validateTaxRates({ "uk.tax.incomeTax": 101 }).ok).toBe(false);
  });
});

describe("validateBudget", () => {
  it("passes a well-formed budget", () => {
    expect(
      validateBudget({
        taxRates: { "uk.tax.incomeTax": 25 },
        spendingAllocations: { healthcare: 50, defense: 50 },
      }).ok
    ).toBe(true);
  });
  it("fails on either half", () => {
    expect(
      validateBudget({
        taxRates: { "uk.tax.bad": 1 },
        spendingAllocations: { healthcare: 100 },
      }).ok
    ).toBe(false);
  });
});
