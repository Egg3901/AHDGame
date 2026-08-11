import { describe, it, expect } from "vitest";
import { POLICY_INTENSITY_GAMMA, effectiveIntensity, metricRangeScale } from "./formulas";

describe("effectiveIntensity", () => {
  it("keeps 0 and ±1 fixed points", () => {
    expect(effectiveIntensity(0)).toBe(0);
    expect(effectiveIntensity(1)).toBeCloseTo(1, 6);
    expect(effectiveIntensity(-1)).toBeCloseTo(-1, 6);
  });
  it("is convex: a mid intensity gains vs linear when gamma < 1", () => {
    // 0.5 ** 0.8 ≈ 0.574 > 0.5
    expect(effectiveIntensity(0.5)).toBeCloseTo(0.5 ** POLICY_INTENSITY_GAMMA, 6);
    expect(effectiveIntensity(0.5)).toBeGreaterThan(0.5);
  });
  it("preserves sign", () => {
    expect(effectiveIntensity(-0.5)).toBeCloseTo(-(0.5 ** POLICY_INTENSITY_GAMMA), 6);
  });
});

describe("metricRangeScale", () => {
  it("is 1.0 for a 0-100 index metric regardless of value", () => {
    expect(metricRangeScale(0, 100, 50)).toBe(1);
    expect(metricRangeScale(0, 100, 0)).toBe(1);
  });
  it("is 1.0 for a tight signed range (e.g. populationGrowth -3..5)", () => {
    expect(metricRangeScale(-3, 5, 2)).toBe(1);
  });
  it("scales a large-range metric by ~1% of its OPERATING value, not its bound", () => {
    // educationSpending: cap 10M but operates ~£13k → scale 130 (a max law moves it ~£130 target).
    expect(metricRangeScale(0, 10_000_000, 13_000)).toBe(130);
    // medianIncome: same 10M cap but operates ~£40k → scale 400 (decoupled from the bound).
    expect(metricRangeScale(0, 10_000_000, 40_000)).toBe(400);
  });
  it("uses absolute value so a negative operating value still scales", () => {
    expect(metricRangeScale(0, 20_000, -5_000)).toBe(50);
  });
});
