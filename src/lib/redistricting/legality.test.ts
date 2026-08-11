import { describe, it, expect } from "vitest";
import { computeEfficiencyGap, validateRedistrictMap, PACKED_THRESHOLD } from "./legality";

const budget = { left: 32, right: 32, grey: 0 }; // n=4, 64 squares

describe("computeEfficiencyGap", () => {
  it("is ~0 for a symmetric map", () => {
    const map = [
      { left: 12, right: 4, grey: 0 },
      { left: 4, right: 12, grey: 0 },
      { left: 12, right: 4, grey: 0 },
      { left: 4, right: 12, grey: 0 },
    ];
    expect(computeEfficiencyGap(map)).toBeLessThan(0.1);
  });
  it("is larger for a cracked map than a balanced one", () => {
    const balanced = [
      { left: 7, right: 9, grey: 0 },
      { left: 7, right: 9, grey: 0 },
      { left: 9, right: 7, grey: 0 },
      { left: 9, right: 7, grey: 0 },
    ];
    const cracked = [
      { left: 7, right: 9, grey: 0 },
      { left: 7, right: 9, grey: 0 },
      { left: 7, right: 9, grey: 0 },
      { left: 11, right: 5, grey: 0 },
    ];
    expect(computeEfficiencyGap(cracked)).toBeGreaterThan(computeEfficiencyGap(balanced));
  });
});

describe("validateRedistrictMap", () => {
  const caps = {
    canDraw: true,
    autoNeutralize: false,
    maxDistrictDeviation: 6,
    maxPackedDistricts: 1,
    efficiencyGapCeiling: 0.2,
  };

  it("accepts a conserved, compact map", () => {
    const map = [
      { left: 10, right: 6, grey: 0 },
      { left: 6, right: 10, grey: 0 },
      { left: 10, right: 6, grey: 0 },
      { left: 6, right: 10, grey: 0 },
    ];
    const res = validateRedistrictMap(map, budget, caps);
    expect(res.legal).toBe(true);
    expect(res.violations).toEqual([]);
  });

  it("rejects a non-conserving map", () => {
    const bad = [
      { left: 15, right: 1, grey: 0 }, // left total 31 ≠ 32
      { left: 16, right: 0, grey: 0 },
      { left: 0, right: 16, grey: 0 },
      { left: 0, right: 16, grey: 0 },
    ];
    const res = validateRedistrictMap(bad, budget, caps);
    expect(res.legal).toBe(false);
    expect(res.violations.join(" ")).toMatch(/conserv/i);
  });

  it("rejects too many packed districts", () => {
    const map = [
      { left: 16, right: 0, grey: 0 }, // packed
      { left: 16, right: 0, grey: 0 }, // packed → 2 > maxPackedDistricts 1
      { left: 0, right: 16, grey: 0 }, // packed
      { left: 0, right: 16, grey: 0 }, // packed
    ];
    const res = validateRedistrictMap(map, budget, caps);
    expect(res.legal).toBe(false);
    expect(res.violations.join(" ")).toMatch(/packed/i);
    expect(PACKED_THRESHOLD).toBe(12);
  });

  it("rejects when canDraw is false", () => {
    const map = [
      { left: 10, right: 6, grey: 0 },
      { left: 6, right: 10, grey: 0 },
      { left: 10, right: 6, grey: 0 },
      { left: 6, right: 10, grey: 0 },
    ];
    const res = validateRedistrictMap(map, budget, { ...caps, canDraw: false });
    expect(res.legal).toBe(false);
    expect(res.violations.join(" ")).toMatch(/commission|cannot draw/i);
  });
});
