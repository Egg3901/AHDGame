import { describe, it, expect } from "vitest";
import type { CommodityType } from "@/lib/constants/commodities";
import {
  computePriceRealization,
  PRICE_REALIZATION_MAX,
  PRICE_REALIZATION_MIN,
} from "./priceRealization";

function ratios(entries: Array<[CommodityType, number]>): Map<CommodityType, number> {
  return new Map(entries);
}

describe("computePriceRealization", () => {
  it("returns exactly 1 with no supply rates", () => {
    expect(computePriceRealization({}, ratios([["iron", 2]]))).toBe(1);
  });

  it("returns exactly 1 when all rates are zero or negative", () => {
    expect(
      computePriceRealization(
        { iron: 0, coal: -0.1 },
        ratios([
          ["iron", 2],
          ["coal", 2],
        ])
      )
    ).toBe(1);
  });

  it("is 1 for a single commodity priced at base", () => {
    expect(computePriceRealization({ iron: 0.72 }, ratios([["iron", 1]]))).toBeCloseTo(1, 10);
  });

  it("rewards a shortage: iron at 1.68× base → ~+30% revenue", () => {
    expect(computePriceRealization({ iron: 1 }, ratios([["iron", 1.68]]))).toBeCloseTo(1.2961, 3);
  });

  it("bleeds a glut: 0.67× base → ~−18% revenue", () => {
    expect(
      computePriceRealization(
        { entertainment_services: 1 },
        ratios([["entertainment_services", 0.67]])
      )
    ).toBeCloseTo(0.8185, 3);
  });

  it("clamps extreme shortage spikes at the max", () => {
    expect(computePriceRealization({ rare_earth: 1 }, ratios([["rare_earth", 9]]))).toBe(
      PRICE_REALIZATION_MAX
    );
  });

  it("clamps extreme glut collapses at the min", () => {
    expect(computePriceRealization({ food: 1 }, ratios([["food", 0.1]]))).toBe(
      PRICE_REALIZATION_MIN
    );
  });

  it("weights by supply rates across the output mix", () => {
    // rates 3 and 1 with ratios 1.44 (factor 1.2) and 1.0 → (3×1.2 + 1×1)/4 = 1.15
    expect(
      computePriceRealization(
        { iron: 3, coal: 1 },
        ratios([
          ["iron", 1.44],
          ["coal", 1],
        ])
      )
    ).toBeCloseTo(1.15, 10);
  });

  it("treats a commodity missing from the price map as priced at base", () => {
    expect(computePriceRealization({ iron: 1 }, ratios([]))).toBe(1);
  });

  it("treats non-finite, zero, and negative ratios as priced at base", () => {
    expect(computePriceRealization({ iron: 1 }, ratios([["iron", Number.NaN]]))).toBe(1);
    expect(computePriceRealization({ iron: 1 }, ratios([["iron", Infinity]]))).toBe(1);
    expect(computePriceRealization({ iron: 1 }, ratios([["iron", 0]]))).toBe(1);
    expect(computePriceRealization({ iron: 1 }, ratios([["iron", -2]]))).toBe(1);
  });
});
