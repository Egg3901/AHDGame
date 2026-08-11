import { describe, it, expect } from "vitest";
import { statMultiplier } from "../statMultiplier";

describe("statMultiplier", () => {
  it("returns ~0.82 at the floor (stat 1)", () => {
    expect(statMultiplier(1)).toBeCloseTo(0.82, 5);
  });

  it("returns exactly 1.0 at the pivot (stat 5.5)", () => {
    expect(statMultiplier(5.5)).toBe(1);
  });

  it("returns ~1.0 across the 5–6 baseline band", () => {
    expect(statMultiplier(5)).toBeCloseTo(0.98, 5);
    expect(statMultiplier(6)).toBeCloseTo(1.02, 5);
  });

  it("returns ~1.18 at the cap (stat 10)", () => {
    expect(statMultiplier(10)).toBeCloseTo(1.18, 5);
  });

  it("clamps out-of-range input to the legal stat band", () => {
    expect(statMultiplier(-3)).toBe(statMultiplier(1));
    expect(statMultiplier(99)).toBe(statMultiplier(10));
  });
});
