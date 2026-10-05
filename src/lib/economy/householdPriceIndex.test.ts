import { describe, expect, it } from "vitest";
import { TURNS_PER_YEAR } from "@/lib/constants/turnTime";
import {
  advanceHouseholdPriceIndex,
  householdPriceAdjustedValue,
  householdPriceTurnFactor,
  HOUSEHOLD_PRICE_INFLATION_PASSTHROUGH,
} from "./householdPriceIndex";

/** Run the real per-turn advance over a sequence of annual CPI observations. */
function accumulate(annualRates: readonly (number | null | undefined)[], start = 1): number {
  return annualRates.reduce<number>(
    (index, rate) => advanceHouseholdPriceIndex(index, rate),
    start
  );
}

const year = (rate: number | null | undefined) =>
  Array.from({ length: TURNS_PER_YEAR }, () => rate);

describe("advanceHouseholdPriceIndex", () => {
  it.each([0, 2, 8, 25, 100])(
    "accumulates exactly the documented passthrough over a year at CPI %s percent",
    (rate) => {
      expect(accumulate(year(rate))).toBeCloseTo(
        1 + (HOUSEHOLD_PRICE_INFLATION_PASSTHROUGH * rate) / 100,
        10
      );
    }
  );

  it("compounds whole years multiplicatively", () => {
    expect(accumulate([...year(8), ...year(8)])).toBeCloseTo(1.06 ** 2, 10);
  });

  it("lands a year of varying CPI on the geometric mean of its annual factors", () => {
    const rates = [
      ...Array.from({ length: 24 }, () => 8),
      ...Array.from({ length: 24 }, () => 100),
    ];
    const expected = Math.sqrt(1.06 * 1.75);
    expect(accumulate(rates)).toBeCloseTo(expected, 10);
    expect(accumulate([...rates].reverse())).toBeCloseTo(expected, 10);
  });

  it("applies one turn's share of the annual factor", () => {
    expect(advanceHouseholdPriceIndex(1, 8)).toBeCloseTo(1.06 ** (1 / TURNS_PER_YEAR), 12);
    expect(householdPriceTurnFactor(8)).toBeCloseTo(1.06 ** (1 / TURNS_PER_YEAR), 12);
  });

  it("seeds absent legacy values at the neutral index", () => {
    expect(advanceHouseholdPriceIndex(undefined, 0)).toBe(1);
    expect(advanceHouseholdPriceIndex(0, 0)).toBe(1);
    expect(advanceHouseholdPriceIndex(-3, 0)).toBe(1);
    expect(advanceHouseholdPriceIndex(Number.NaN, 0)).toBe(1);
  });

  it("treats missing or non-finite CPI as no price change", () => {
    for (const rate of [undefined, null, Number.NaN, Infinity, -Infinity]) {
      expect(advanceHouseholdPriceIndex(1.5, rate)).toBe(1.5);
    }
  });

  it("lets deflation lower household prices by its passthrough without crossing zero", () => {
    expect(advanceHouseholdPriceIndex(1, -2)).toBeLessThan(1);
    expect(accumulate(year(-2))).toBeCloseTo(
      1 - (HOUSEHOLD_PRICE_INFLATION_PASSTHROUGH * 2) / 100,
      10
    );
  });

  it("clamps impossible deflation and keeps the index positive and finite", () => {
    expect(householdPriceTurnFactor(-500)).toBe(householdPriceTurnFactor(-100));
    expect(accumulate(year(-100))).toBeCloseTo(0.25, 10);
    const longRun = accumulate(Array.from({ length: TURNS_PER_YEAR * 400 }, () => -500));
    expect(longRun).toBeGreaterThan(0);
    expect(Number.isFinite(longRun)).toBe(true);
  });

  it("never writes a non-finite level from an extreme prior", () => {
    expect(advanceHouseholdPriceIndex(Number.MAX_VALUE, 1_000)).toBe(Number.MAX_VALUE);
  });
});

describe("householdPriceAdjustedValue", () => {
  it("reports purchasing power without changing the nominal amount", () => {
    expect(householdPriceAdjustedValue(50_000, 1.25)).toBe(40_000);
    expect(householdPriceAdjustedValue(50_000, undefined)).toBe(50_000);
  });
});
