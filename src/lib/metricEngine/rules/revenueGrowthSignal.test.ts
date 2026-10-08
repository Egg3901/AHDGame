import { describe, expect, it } from "vitest";
import {
  realRevenueGrowth,
  SECTOR_FORMATION_NEUTRAL_PCT,
} from "@/lib/metricEngine/rules/revenueGrowthSignal";
import {
  computeRealizedRevenueGrowthRate,
  computeTrailingRevenueGrowthRate,
} from "@/lib/turn/gdpGrowth";

describe("realRevenueGrowth", () => {
  it("strips inflation from a nominal reading", () => {
    expect(realRevenueGrowth(16, 16)).toBeCloseTo(0, 6);
    expect(realRevenueGrowth(10, 0)).toBeCloseTo(10, 6);
    expect(realRevenueGrowth(10, undefined)).toBeCloseTo(10, 6);
  });

  it("caps the deflator at the commodity index ceiling", () => {
    expect(realRevenueGrowth(60, 61)).toBeCloseTo((1.6 / 1.25 - 1) * 100, 6);
  });

  it("reads a base growing from near zero as sector formation, not a boom", () => {
    expect(realRevenueGrowth(6300, 14)).toBe(SECTOR_FORMATION_NEUTRAL_PCT);
  });
});

describe("revenue trend signals are real, not nominal", () => {
  it("a 16% nominal trend at 16% inflation is flat", () => {
    const signal = computeTrailingRevenueGrowthRate(116, { value: 100, spanTurns: 48 }, 48, 16);
    expect(signal).toBeCloseTo(0, 6);
  });

  it("a founding-window ramp from a near-empty base stays neutral instead of pinning the cap", () => {
    const signal = computeTrailingRevenueGrowthRate(
      4_180_000,
      { value: 65_000, spanTurns: 32 },
      48,
      14
    );
    expect(signal).toBe(SECTOR_FORMATION_NEUTRAL_PCT);
  });

  it("the one-turn fallback is deflated and formation-guarded too", () => {
    expect(computeRealizedRevenueGrowthRate(100.3, 100, 1, 48, 16)).toBeCloseTo(
      ((1 + 0.3 * 0.48) / 1.16 - 1) * 100,
      3
    );
    expect(computeRealizedRevenueGrowthRate(500, 100, 1, 48, 14)).toBe(
      SECTOR_FORMATION_NEUTRAL_PCT
    );
  });
});
