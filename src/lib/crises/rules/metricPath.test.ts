import { describe, expect, it } from "vitest";
import { resolveCrisisMetricPath } from "./metricPath";

describe("resolveCrisisMetricPath", () => {
  it("routes engine-owned GDP growth shocks through sector growth", () => {
    expect(resolveCrisisMetricPath("economic", "gdpGrowth")).toEqual({
      category: "economic",
      field: "sectorGrowth",
    });
  });

  it("leaves other crisis metric paths unchanged", () => {
    expect(resolveCrisisMetricPath("economic", "unemploymentRate")).toEqual({
      category: "economic",
      field: "unemploymentRate",
    });
  });
});
