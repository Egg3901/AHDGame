import { describe, it, expect } from "vitest";
import { categoryRollup } from "./categoryRollup";

// unemploymentRate threshold: best 2, worst 15 (lower better) → value 2 ≈ 100, 15 ≈ 0.
// lifeExpectancy threshold: best 85, worst 70 (higher better) → 85 ≈ 100.
describe("categoryRollup", () => {
  it("averages scores and counts strong/weak metrics", () => {
    const summary = {
      unemploymentRate: { populationWeightedAverage: 2 }, // ~100 strong
      lifeExpectancy: { populationWeightedAverage: 70 }, // ~0 weak
    };
    const r = categoryRollup(summary, "US");
    expect(r.count).toBe(2);
    expect(r.strong).toBe(1);
    expect(r.weak).toBe(1);
    expect(r.avgScore).toBeGreaterThan(40);
    expect(r.avgScore).toBeLessThan(60);
  });

  it("skips metrics with no scoring threshold", () => {
    const summary = {
      unemploymentRate: { populationWeightedAverage: 2 },
      someUnscoredMetric: { populationWeightedAverage: 50 },
    };
    const r = categoryRollup(summary, "US");
    expect(r.count).toBe(1);
  });

  it("returns zeros for an empty category", () => {
    const r = categoryRollup({}, "US");
    expect(r).toEqual({ avgScore: 0, strong: 0, weak: 0, count: 0 });
  });
});
