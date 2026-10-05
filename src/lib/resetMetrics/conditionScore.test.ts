import { describe, expect, it } from "vitest";
import { primaryMetrics } from "./catalog";
import { buildOpeningMetricSnapshots1991 } from "./seedOpening1991";
import { resetMetricConditionScore } from "./conditionScore";

describe("v2 metric condition score", () => {
  it("scores every opening primary without averaging incompatible raw units", () => {
    const snapshots = buildOpeningMetricSnapshots1991("world-test", 1);
    const regional = snapshots.find((row) => row._id === "US:CT")!;
    const national = snapshots.find((row) => row._id === "US:national")!;
    const observations = { ...regional.observations, ...national.observations };

    for (const metric of primaryMetrics) {
      const score = resetMetricConditionScore(
        metric,
        observations[metric.id]?.value ?? null,
        "US",
        1991
      );
      expect(score, metric.name).not.toBeNull();
      expect(score!, metric.name).toBeGreaterThanOrEqual(0);
      expect(score!, metric.name).toBeLessThanOrEqual(100);
    }
  });

  it("handles v2 direction and unit adapters", () => {
    const metric = (id: string) => primaryMetrics.find((candidate) => candidate.id === id)!;

    expect(resetMetricConditionScore(metric("16"), 95, "US", 1991)).toBeGreaterThan(
      resetMetricConditionScore(metric("16"), 80, "US", 1991)!
    );
    expect(resetMetricConditionScore(metric("24"), 80, "US", 1991)).toBeGreaterThan(
      resetMetricConditionScore(metric("24"), 140, "US", 1991)!
    );
    expect(resetMetricConditionScore(metric("35"), 80, "US", 1991)).toBeGreaterThan(
      resetMetricConditionScore(metric("35"), 30, "US", 1991)!
    );
    expect(resetMetricConditionScore(metric("07"), 2, "US", 1991)).toBe(100);
    expect(resetMetricConditionScore(metric("07"), 10, "US", 1991)).toBeLessThan(50);
  });
});
