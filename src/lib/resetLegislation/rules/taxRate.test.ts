import { describe, expect, it } from "vitest";
import { legislationTypes } from "@/lib/seeds/reference/legislationTypes";
import { resetTaxes } from "../taxCatalog";
import { taxRateBoundsFromExistingOptions, validateExactTaxRate } from "./taxRate";

describe("exact reset tax-rate choices", () => {
  it("derives each instrument's bounds from its existing in-game options", () => {
    for (const tax of resetTaxes) {
      const type = legislationTypes.find((row) => row._id === tax.existingLegislationTypeId)!;
      const bounds = taxRateBoundsFromExistingOptions(type.policyOptions ?? []);
      expect(bounds.min).toBeGreaterThanOrEqual(0);
      expect(bounds.max).toBeLessThanOrEqual(100);
      expect(bounds.step).toBe(0.01);
      expect(bounds.max).toBeGreaterThan(bounds.min);
    }
  });

  it("accepts a precise rate between existing bounds, not just a named bracket", () => {
    expect(validateExactTaxRate(10, 10.25, { min: 0, max: 60, step: 0.01 })).toEqual({
      allowed: true,
      rateChange: 0.25,
    });
    expect(validateExactTaxRate(1.4, 1.4, { min: 0, max: 5, step: 0.01 }).reason).toBe("unchanged");
    expect(validateExactTaxRate(10, 60.5, { min: 0, max: 60, step: 0.01 }).reason).toBe(
      "outside_bounds"
    );
    expect(validateExactTaxRate(10, 10.001, { min: 0, max: 60, step: 0.01 }).reason).toBe(
      "outside_bounds"
    );
  });
});
