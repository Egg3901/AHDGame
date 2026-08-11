import { describe, it, expect } from "vitest";
import { applyDecay } from "./turnoutDecay";

describe("turnoutDecay", () => {
  it("reduces modifier by 2% per turn", () => {
    expect(applyDecay(10)).toBeCloseTo(9.8);
    expect(applyDecay(5)).toBeCloseTo(4.9);
  });

  it("rounds to zero when below threshold", () => {
    expect(applyDecay(0.005)).toBe(0);
    expect(applyDecay(-0.005)).toBe(0);
  });

  it("works with negative modifiers", () => {
    expect(applyDecay(-10)).toBeCloseTo(-9.8);
  });

  it("maintains sign", () => {
    const positive = applyDecay(1);
    const negative = applyDecay(-1);
    expect(positive).toBeGreaterThan(0);
    expect(negative).toBeLessThan(0);
  });
});
