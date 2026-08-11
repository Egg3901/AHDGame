import { describe, it, expect } from "vitest";
import { aidGrowthBoost } from "./aid";

describe("aidGrowthBoost", () => {
  it("is zero for non-positive amounts", () => {
    expect(aidGrowthBoost(0)).toBe(0);
    expect(aidGrowthBoost(-5)).toBe(0);
  });

  it("grows with aid size and is capped", () => {
    const small = aidGrowthBoost(1_000_000); // $1M
    const big = aidGrowthBoost(1_000_000_000); // $1B
    expect(big).toBeGreaterThan(small);
    expect(aidGrowthBoost(1e15)).toBeLessThanOrEqual(0.5);
  });
});
