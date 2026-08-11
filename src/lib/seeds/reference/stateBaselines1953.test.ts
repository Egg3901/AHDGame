import { describe, expect, it } from "vitest";
import { applyEra1953BaselineAdjustments } from "./stateBaselines1953";
import type { StateMetricBaseline } from "@/lib/db/types";

function baselineWithMedianAge(medianAge: number): StateMetricBaseline {
  return {
    _id: "TEST",
    countryId: "NG",
    baselines: {
      population: { medianAge },
    },
  } as unknown as StateMetricBaseline;
}

describe("applyEra1953BaselineAdjustments — medianAge band vs metrics", () => {
  it("admits the same young floor as stateMetricsEra1953 ([15, 36], not old [18, 32])", () => {
    // A decay target floored at 18 would drag an era-real 16 toward a modern
    // Western floor over a long sim. Pass-through keeps already-young 16.
    const out = applyEra1953BaselineAdjustments(baselineWithMedianAge(16));
    const age = out.baselines.population!.medianAge as number;
    expect(age).toBe(16);
    expect(age).toBeLessThan(18);
    expect(age).toBeGreaterThanOrEqual(15);
  });

  it("admits the same old ceiling as stateMetricsEra1953 (36, not old 32)", () => {
    // Modern-old 48 → 40, clamped to 36 (metric band hi). Old baseline hi was 32.
    const out = applyEra1953BaselineAdjustments(baselineWithMedianAge(48));
    const age = out.baselines.population!.medianAge as number;
    expect(age).toBe(36);
    expect(age).toBeGreaterThan(32);
  });

  it("still applies −8 to a modern mid age that is not already young (BR-like 28)", () => {
    const out = applyEra1953BaselineAdjustments(baselineWithMedianAge(28));
    expect(out.baselines.population!.medianAge).toBe(20);
  });
});
