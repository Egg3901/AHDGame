import { describe, expect, it } from "vitest";
import { resolveCrisisMetricPath } from "./metricPath";

describe("resolveCrisisMetricPath", () => {
  it("routes engine-owned GDP growth shocks through sector growth", () => {
    expect(resolveCrisisMetricPath("economic", "gdpGrowth")).toEqual({
      category: "economic",
      field: "sectorGrowth",
      bounds: [-10, 15],
    });
  });

  it("bounds the sector channel to the engine signal range, not a zero floor", () => {
    const [min, max] = resolveCrisisMetricPath("economic", "gdpGrowth").bounds ?? [0, 100];
    expect(min).toBeLessThan(0);
    expect(max).toBe(15);
  });

  it("leaves other crisis metric paths unchanged", () => {
    expect(resolveCrisisMetricPath("economic", "unemploymentRate")).toEqual({
      category: "economic",
      field: "unemploymentRate",
    });
  });
});
