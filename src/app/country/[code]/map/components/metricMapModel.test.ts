import { describe, it, expect } from "vitest";
import { formatMapMetric, metricExtent, metricRatio, metricDistribution } from "./metricMapModel";
import type { MapMetricDefinition } from "@/lib/map/metricTypes";
const money: MapMetricDefinition = {
  id: "gdp",
  name: "GDP",
  category: "economy",
  description: "",
  prefix: "$",
  suffix: "",
  decimals: 0,
  source: "state",
};
describe("metric comparisons", () => {
  it("preserves money units and distinguishes zero from missing", () => {
    expect(formatMapMetric(2_500_000, money, true)).toBe("$2.5M");
    expect(formatMapMetric(0, money)).toBe("$0");
    expect(formatMapMetric(undefined, money)).toBe("");
  });
  it("computes the median of measured states with negative values", () => {
    expect(metricExtent([-4, 2, 6, NaN])).toEqual({ min: -4, max: 6, median: 2 });
    expect(metricExtent([1, 7])).toEqual({ min: 1, max: 7, median: 4 });
    expect(metricExtent([])).toBeNull();
  });
  it("handles identical values and includes both range endpoints", () => {
    expect(metricRatio(5, 5, 5)).toBe(0.5);
    expect(metricDistribution([-5, 0, 5], -5, 5)).toEqual([1, 0, 1, 0, 1]);
    expect(metricDistribution([5, 5], 5, 5)).toEqual([0, 0, 2, 0, 0]);
  });
});
