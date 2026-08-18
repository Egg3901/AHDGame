import { describe, expect, it } from "vitest";
import {
  advanceHouseholdPriceIndex,
  householdPriceAdjustedValue,
  HOUSEHOLD_PRICE_INFLATION_PASSTHROUGH,
} from "./householdPriceIndex";

describe("advanceHouseholdPriceIndex", () => {
  it("uses a partial per-turn pass-through of annual CPI", () => {
    expect(advanceHouseholdPriceIndex(1, 8)).toBeCloseTo(
      1 + (HOUSEHOLD_PRICE_INFLATION_PASSTHROUGH * 8) / 100 / 48,
      12
    );
  });

  it("seeds absent legacy values at the neutral index", () => {
    expect(advanceHouseholdPriceIndex(undefined, 0)).toBe(1);
  });

  it("lets deflation lower household prices without crossing zero", () => {
    expect(advanceHouseholdPriceIndex(1, -2)).toBeLessThan(1);
    expect(advanceHouseholdPriceIndex(1, -2)).toBeGreaterThan(0);
  });
});

describe("householdPriceAdjustedValue", () => {
  it("reports purchasing power without changing the nominal amount", () => {
    expect(householdPriceAdjustedValue(50_000, 1.25)).toBe(40_000);
    expect(householdPriceAdjustedValue(50_000, undefined)).toBe(50_000);
  });
});
