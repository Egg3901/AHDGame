import { describe, expect, it } from "vitest";
import { legislationTypes } from "@/lib/seeds/reference/legislationTypes";
import { US_LAWS } from "@/lib/countries/us/data/usLaws";
import { UK_LAWS } from "@/lib/countries/uk/data/ukLaws";
import { US_STATE_TAX_LAWS } from "@/lib/countries/us/data/usStateTaxLaws";
import { projectLawToLegislationType } from "@/lib/politicalLegislation/project";
import { resetTaxes } from "../taxCatalog";
import { taxRateBoundsFromExistingOptions, validateExactTaxRate } from "./taxRate";

describe("exact reset tax-rate choices", () => {
  it("derives each instrument's bounds from its existing in-game options", () => {
    const runtimeTypes = [
      ...legislationTypes,
      ...US_LAWS.map(projectLawToLegislationType),
      ...UK_LAWS.map(projectLawToLegislationType),
      ...US_STATE_TAX_LAWS.map(projectLawToLegislationType),
    ];
    for (const tax of resetTaxes) {
      const type = runtimeTypes.find((row) => row._id === tax.existingLegislationTypeId)!;
      const bounds = type.taxSlider
        ? { min: type.taxSlider.minRate, max: type.taxSlider.maxRate, step: type.taxSlider.step }
        : taxRateBoundsFromExistingOptions(type.policyOptions ?? []);
      expect(bounds.min).toBeGreaterThanOrEqual(0);
      expect(bounds.max).toBeLessThanOrEqual(100);
      expect(bounds.step).toBeGreaterThan(0);
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
