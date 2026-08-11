import { describe, it, expect } from "vitest";
import { resolveRedistrictCaps } from "./caps";

describe("resolveRedistrictCaps", () => {
  it("default (center) options: bipartisan commission cannot draw, moderate caps", () => {
    const caps = resolveRedistrictCaps(1, 1, 1, 12);
    expect(caps.canDraw).toBe(false); // bipartisan commission
    expect(caps.autoNeutralize).toBe(false);
    expect(caps.maxDistrictDeviation).toBe(8);
    expect(caps.maxPackedDistricts).toBe(Math.ceil(12 / 3)); // moderate frac 1/3
    expect(caps.efficiencyGapCeiling).toBeCloseTo(0.2, 5);
  });

  it("independent commission auto-neutralizes and cannot draw", () => {
    const caps = resolveRedistrictCaps(0, 1, 1, 10);
    expect(caps.canDraw).toBe(false);
    expect(caps.autoNeutralize).toBe(true);
  });

  it("legislature-drawn + loose compactness + loose fairness unlocks a wide draw", () => {
    const caps = resolveRedistrictCaps(2, 2, 2, 12);
    expect(caps.canDraw).toBe(true);
    expect(caps.maxDistrictDeviation).toBe(12);
    expect(caps.maxPackedDistricts).toBe(Math.ceil(12 / 2));
    expect(caps.efficiencyGapCeiling).toBeCloseTo(0.35, 5);
  });

  it("strict compactness forbids any packed district", () => {
    const caps = resolveRedistrictCaps(2, 0, 0, 12);
    expect(caps.maxDistrictDeviation).toBe(4);
    expect(caps.maxPackedDistricts).toBe(0);
    expect(caps.efficiencyGapCeiling).toBeCloseTo(0.1, 5);
  });
});
