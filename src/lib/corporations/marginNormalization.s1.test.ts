import { describe, expect, it } from "vitest";
import type { StateMetrics } from "@/lib/db/types";
import { computeStateMetricMarginModifier } from "./sectorMetricMarginProfiles";

/**
 * S1 follow-up: the margin system normalizes a metric's value over a realistic
 * range. After S1 widened `educationSpending`'s safety bounds to [0, 10_000_000]
 * (multi-currency clamp), reusing those bounds as the normalization range pinned
 * every realistic spend to ~−1. The fix normalizes over the metric's THRESHOLDS
 * [worst, best] (here 3000 / 15000), so spend quality is responsive again.
 */
function metricsWithEducationSpending(value: number): StateMetrics {
  return {
    _id: "US-CA",
    countryId: "US",
    lastUpdated: new Date(),
    education: { educationSpending: { value } },
  } as unknown as StateMetrics;
}

function educationSpendingModifier(value: number): number {
  const result = computeStateMetricMarginModifier({
    sectorType: "technology",
    strategyId: "software",
    stateMetrics: metricsWithEducationSpending(value),
    countryId: "US",
  });
  return result.contributions
    .filter((c) => c.metricId === "educationSpending")
    .reduce((s, c) => s + c.modifier, 0);
}

describe("margin normalization uses realistic ranges (S1)", () => {
  it("educationSpending margin responds to spend level (best > worst)", () => {
    const best = educationSpendingModifier(15_000); // THRESHOLDS best
    const worst = educationSpendingModifier(3_000); // THRESHOLDS worst
    // High education spend must help labor-quality margins more than low spend.
    expect(best).toBeGreaterThan(worst);
    expect(best).toBeGreaterThan(0);
    expect(worst).toBeLessThan(0);
  });
});
