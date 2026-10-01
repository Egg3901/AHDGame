import { describe, expect, it } from "vitest";
import { primaryMetrics, primaryMetricById, primaryMetricByPath } from "./catalog";

describe("reset primary metric catalog", () => {
  it("has exactly 58 unique primary ids and paths", () => {
    expect(primaryMetrics).toHaveLength(58);
    expect(new Set(primaryMetrics.map((metric) => metric.id)).size).toBe(58);
    expect(new Set(primaryMetrics.map((metric) => metric.path)).size).toBe(58);
  });

  it("makes the ten missing 1991 observations explicit", () => {
    expect(primaryMetrics.filter((metric) => metric.openingSource === "derive")).toHaveLength(10);
    expect(primaryMetricByPath("population.dependencyRatio")?.openingSource).toBe("derive");
  });

  it("keeps value direction contextual for balances and demographic flows", () => {
    expect(primaryMetricByPath("economic.tradeBalance")?.interpretation).toBe("context");
    expect(primaryMetricByPath("population.birthRate")?.interpretation).toBe("context");
    expect(primaryMetricById("20")?.path).toBe("healthcare.lifeExpectancy");
  });

  it("provides readable descriptions without prohibited dash characters", () => {
    for (const metric of primaryMetrics) {
      expect(metric.name.trim()).not.toBe("");
      expect(metric.description.trim()).not.toBe("");
      expect(metric.description).not.toMatch(/[\u2013\u2014]/);
    }
  });
});
