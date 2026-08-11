import { describe, expect, it } from "vitest";
import { resolveMetricPath } from "./resolveMetricPath";

describe("resolveMetricPath", () => {
  it("resolves a bare metric id to its category path via the global registry", () => {
    expect(resolveMetricPath("gdpGrowth")).toBe("economic.gdpGrowth");
    expect(resolveMetricPath("crimeRate")).toBe("publicSafety.crimeRate");
    expect(resolveMetricPath("airQuality")).toBe("environment.airQuality");
  });

  it("resolves CN-scoped flavor metrics", () => {
    expect(resolveMetricPath("socialCreditCoverage")).toBe("governance.socialCreditCoverage");
    expect(resolveMetricPath("beltAndRoadEngagement")).toBe("governance.beltAndRoadEngagement");
    expect(resolveMetricPath("commonProsperityIndex")).toBe("economic.commonProsperityIndex");
  });

  it("is idempotent on already-dotted paths", () => {
    expect(resolveMetricPath("economic.gdpGrowth")).toBe("economic.gdpGrowth");
  });

  it("prefers a supplied position-metric category over the global registry", () => {
    expect(resolveMetricPath("gdpGrowth", [{ category: "economic", metricId: "gdpGrowth" }])).toBe(
      "economic.gdpGrowth"
    );
  });

  it("returns the key unchanged when it cannot be resolved", () => {
    expect(resolveMetricPath("nonexistentMetric")).toBe("nonexistentMetric");
  });
});
