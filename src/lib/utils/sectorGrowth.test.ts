import { describe, it, expect } from "vitest";
import { trendGrowthRate } from "./sectorGrowth";
import {
  GROWTH_TREND_STEP_PER_TURN,
  MAX_GROWTH_RATE,
  MIN_GROWTH_RATE,
} from "@/lib/constants/corporations";

describe("trendGrowthRate", () => {
  it("returns current unchanged when already at target", () => {
    expect(trendGrowthRate(5, 5)).toBe(5);
    expect(trendGrowthRate(0, 0)).toBe(0);
    expect(trendGrowthRate(-1.5, -1.5)).toBe(-1.5);
  });

  it("moves up by the per-turn step when target is above current", () => {
    expect(trendGrowthRate(0, 10)).toBe(GROWTH_TREND_STEP_PER_TURN);
    expect(trendGrowthRate(2, 10)).toBe(2 + GROWTH_TREND_STEP_PER_TURN);
  });

  it("moves down by the per-turn step when target is below current", () => {
    expect(trendGrowthRate(10, 0)).toBe(10 - GROWTH_TREND_STEP_PER_TURN);
    expect(trendGrowthRate(3, -1)).toBe(3 - GROWTH_TREND_STEP_PER_TURN);
  });

  it("stops exactly at target without overshoot", () => {
    // diff (0.3) is smaller than the step size, so the tick lands on target
    expect(trendGrowthRate(1.2, 1.5)).toBe(1.5);
    expect(trendGrowthRate(2.8, 2.5)).toBe(2.5);
  });

  it("clamps the target to the allowed growth range before trending", () => {
    // Out-of-range target is treated as if clamped; still moves toward bound
    const stepped = trendGrowthRate(10, 100);
    expect(stepped).toBe(10 + GROWTH_TREND_STEP_PER_TURN);
    expect(stepped).toBeLessThanOrEqual(MAX_GROWTH_RATE);
  });

  it("clamps the resulting current within [MIN_GROWTH_RATE, MAX_GROWTH_RATE]", () => {
    expect(trendGrowthRate(MAX_GROWTH_RATE, MAX_GROWTH_RATE + 5)).toBe(MAX_GROWTH_RATE);
    expect(trendGrowthRate(MIN_GROWTH_RATE, MIN_GROWTH_RATE - 5)).toBe(MIN_GROWTH_RATE);
  });

  it("rounds to 1 decimal place to avoid floating-point drift", () => {
    // 0.1 + 0.5 should be exactly 0.6, not 0.6000000000000001
    expect(trendGrowthRate(0.1, 10)).toBe(0.6);
  });
});
