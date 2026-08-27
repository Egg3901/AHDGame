import { describe, it, expect } from "vitest";
import {
  validateTaxRates,
  validateProgramLevels,
  validateBudget,
  UK_TAX_LEVER_IDS,
} from "./budgetValidation";

describe("UK_TAX_LEVER_IDS", () => {
  it("includes real UK tax levers", () => {
    expect(UK_TAX_LEVER_IDS.has("uk.tax.incomeTax")).toBe(true);
    expect(UK_TAX_LEVER_IDS.size).toBeGreaterThan(0);
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
    expect(validateTaxRates({ "uk.tax.incomeTax": 61 }).ok).toBe(false);
  });
  it("uses each law's real rate grid", () => {
    expect(validateTaxRates({ "uk.tax.payrollTax": 10.2 }).ok).toBe(true);
    expect(validateTaxRates({ "uk.tax.payrollTax": 10.1 }).ok).toBe(false);
  });
});

describe("validateProgramLevels", () => {
  it("accepts UK national programme-law levels", () => {
    expect(validateProgramLevels({ "uk.defense.armedForces.primary": 1 }).ok).toBe(true);
  });
  it("rejects tax laws, regional laws, and levels outside the statutory ladder", () => {
    expect(validateProgramLevels({ "uk.tax.incomeTax": 1 }).ok).toBe(false);
    expect(validateProgramLevels({ "uk.defense.armedForces.primary": 5 }).ok).toBe(false);
  });
});

describe("validateBudget", () => {
  it("passes a well-formed budget", () => {
    expect(
      validateBudget({
        taxRates: { "uk.tax.incomeTax": 25 },
        programLevels: { "uk.defense.armedForces.primary": 1 },
      }).ok
    ).toBe(true);
  });
  it("fails on either half", () => {
    expect(
      validateBudget({
        taxRates: { "uk.tax.bad": 1 },
        programLevels: {},
      }).ok
    ).toBe(false);
  });
});
