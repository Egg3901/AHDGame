import { describe, expect, it } from "vitest";
import { sexRatioAtAge, agePyramidWeights } from "./sexRatioCurve";

describe("sexRatioAtAge (share-male by age)", () => {
  it("is ~0.512 at birth (≈1.05 M:F)", () => {
    expect(sexRatioAtAge(0)).toBeCloseTo(0.512, 2);
  });
  it("declines monotonically with age", () => {
    for (let age = 1; age <= 100; age++) {
      expect(sexRatioAtAge(age)).toBeLessThanOrEqual(sexRatioAtAge(age - 1));
    }
  });
  it("crosses below 0.5 in the old tail (female-majority)", () => {
    expect(sexRatioAtAge(100)).toBeLessThan(0.5);
    expect(sexRatioAtAge(90)).toBeLessThan(0.5);
  });
  it("stays strictly within (0,1) across the whole range", () => {
    for (let age = 0; age <= 100; age++) {
      const s = sexRatioAtAge(age);
      expect(s).toBeGreaterThan(0);
      expect(s).toBeLessThan(1);
    }
  });
  it("clamps out-of-range ages to the endpoints", () => {
    expect(sexRatioAtAge(-5)).toBe(sexRatioAtAge(0));
    expect(sexRatioAtAge(150)).toBe(sexRatioAtAge(100));
  });
});

describe("agePyramidWeights (normalized bulge-at-top distribution)", () => {
  it("returns one weight per year over [lo,hi] inclusive", () => {
    expect(agePyramidWeights(18, 29, 38)).toHaveLength(12);
    expect(agePyramidWeights(0, 17, 38)).toHaveLength(18);
  });
  it("sums to 1", () => {
    const w = agePyramidWeights(18, 29, 38);
    expect(w.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
  });
  it("puts the most weight on the oldest year in the band (baby-boom tail)", () => {
    // fillBand maps weights[i] to age=lo+i, so weights[span] = oldest year and
    // should hold the largest share. Explicit "fromOldest" direction.
    const w = agePyramidWeights(18, 64, 38, "fromOldest");
    for (let i = 0; i < w.length - 1; i++) {
      expect(w[i]).toBeLessThanOrEqual(w[w.length - 1] + 1e-9);
    }
  });
  it("a younger median tilts more weight toward the top of the band", () => {
    const young = agePyramidWeights(0, 64, 25, "fromOldest");
    const old = agePyramidWeights(0, 64, 50, "fromOldest");
    // youngest median → gentler decay → the oldest year (last index) holds a
    // larger share of the band's mass
    expect(young[young.length - 1]).toBeGreaterThan(old[old.length - 1]);
  });
  it("fromYoungest direction puts the most weight on the youngest year", () => {
    const w = agePyramidWeights(18, 64, 38, "fromYoungest");
    for (let i = 1; i < w.length; i++) {
      expect(w[i]).toBeLessThanOrEqual(w[0] + 1e-9);
    }
  });
  it("a single-year band returns [1]", () => {
    expect(agePyramidWeights(40, 40, 38)).toEqual([1]);
  });
  it("every weight is non-negative", () => {
    for (const w of agePyramidWeights(0, 100, 38)) expect(w).toBeGreaterThanOrEqual(0);
  });
});
