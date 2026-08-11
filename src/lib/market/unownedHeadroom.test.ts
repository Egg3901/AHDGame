import { describe, expect, it } from "vitest";
import { COMMODITY_BASE_PRICES } from "@/lib/constants/commodities";
import { getStrategy } from "@/lib/constants/sectorStrategies";
import { impliedOutputUnits } from "@/lib/market/capital";
import { computeUnownedHeadroomUnits } from "@/lib/market/unownedHeadroom";

describe("computeUnownedHeadroomUnits", () => {
  it("matches impliedOutputUnits using the sector type's standard strategy", () => {
    const strategy = getStrategy("energy", "standard");
    const expected = impliedOutputUnits(50_000, strategy.supply, COMMODITY_BASE_PRICES, 1);
    expect(computeUnownedHeadroomUnits("energy", 50_000, 1)).toBeCloseTo(expected);
    expect(expected).toBeGreaterThan(0);
  });

  it("returns 0 for non-positive revenue", () => {
    expect(computeUnownedHeadroomUnits("energy", 0, 1)).toBe(0);
    expect(computeUnownedHeadroomUnits("energy", -100, 1)).toBe(0);
  });

  it("returns 0 for non-finite revenue", () => {
    expect(computeUnownedHeadroomUnits("energy", NaN, 1)).toBe(0);
  });

  it("differs across sector types with different supply mixes", () => {
    const energy = computeUnownedHeadroomUnits("energy", 100_000, 1);
    const manufacturing = computeUnownedHeadroomUnits("manufacturing", 100_000, 1);
    expect(energy).not.toBeCloseTo(manufacturing, 0);
  });
});
