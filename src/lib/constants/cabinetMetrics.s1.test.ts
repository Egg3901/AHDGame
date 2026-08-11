import { describe, expect, it } from "vitest";
import { getCabinetMetrics } from "./cabinetMetrics";

/**
 * S1 follow-up: the cabinet briefing bar normalizes a metric value over
 * `entry.range`. After S1 widened `educationSpending`'s safety bounds to
 * [0, 10_000_000], reusing them as the bar range pinned the fill to ~0% for any
 * realistic spend. The range must come from the metric's realistic THRESHOLDS
 * span ([3000, 15000]) so the briefing bar reflects the real position.
 */
describe("cabinet metric range uses realistic thresholds (S1)", () => {
  it("educationSpending range is the THRESHOLDS span, not the safety ceiling", () => {
    const entries = getCabinetMetrics("CN", "minister_of_education");
    const edu = entries.find((e) => e.metricId === "educationSpending");
    expect(edu, "minister_of_education should brief on educationSpending").toBeDefined();
    // THRESHOLDS educationSpending = { best: 15000, worst: 3000 }.
    expect(edu!.range.min).toBe(3_000);
    expect(edu!.range.max).toBe(15_000);
  });
});
