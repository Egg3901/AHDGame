import { describe, it, expect } from "vitest";
import { businessAcumenGrowthMultiplier } from "../statsConstants";

describe("businessAcumenGrowthMultiplier", () => {
  it("penalizes unprofitable corps (margin <= 0)", () => {
    expect(businessAcumenGrowthMultiplier(0)).toBe(0.5);
    expect(businessAcumenGrowthMultiplier(-0.3)).toBe(0.5);
  });

  it("gives baseline growth on a thin margin", () => {
    expect(businessAcumenGrowthMultiplier(0.05)).toBe(1.0);
    expect(businessAcumenGrowthMultiplier(0.1)).toBe(1.0);
  });

  it("rewards a healthy margin", () => {
    expect(businessAcumenGrowthMultiplier(0.15)).toBe(1.5);
    expect(businessAcumenGrowthMultiplier(0.25)).toBe(1.5);
  });

  it("rewards a highly profitable corp the most", () => {
    expect(businessAcumenGrowthMultiplier(0.4)).toBe(2.0);
  });

  it("is monotonic non-decreasing in margin", () => {
    const margins = [-0.5, 0, 0.05, 0.1, 0.2, 0.25, 0.3, 1];
    const mults = margins.map(businessAcumenGrowthMultiplier);
    for (let i = 1; i < mults.length; i++) {
      expect(mults[i]).toBeGreaterThanOrEqual(mults[i - 1]);
    }
  });
});
