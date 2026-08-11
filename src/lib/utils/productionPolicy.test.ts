import { describe, it, expect } from "vitest";
import {
  trendProductionPolicy,
  clampProductionPolicy,
  getRevenueMultiplier,
  getOutputMultiplier,
  getInputMultiplier,
  getPolicyEffectInfo,
} from "./productionPolicy";

describe("trendProductionPolicy", () => {
  it("trends toward a positive target by 1 per turn", () => {
    expect(trendProductionPolicy(0, 10)).toBe(1);
    expect(trendProductionPolicy(9, 10)).toBe(10);
  });

  it("trends toward a negative target by 1 per turn", () => {
    expect(trendProductionPolicy(0, -10)).toBe(-1);
    expect(trendProductionPolicy(-9, -10)).toBe(-10);
  });

  it("stops exactly at target — no overshoot", () => {
    expect(trendProductionPolicy(10, 10)).toBe(10);
    expect(trendProductionPolicy(-25, -25)).toBe(-25);
  });

  it("does not overshoot when 1 step away", () => {
    expect(trendProductionPolicy(24, 25)).toBe(25);
    expect(trendProductionPolicy(-24, -25)).toBe(-25);
  });

  it("clamps output to [-25, 25]", () => {
    // Defensive: shouldn't be reachable in practice with integer inputs
    expect(trendProductionPolicy(24, 30)).toBe(25);
    expect(trendProductionPolicy(-24, -30)).toBe(-25);
  });

  it("returns current if target === current", () => {
    expect(trendProductionPolicy(5, 5)).toBe(5);
    expect(trendProductionPolicy(0, 0)).toBe(0);
  });
});

describe("clampProductionPolicy", () => {
  it("clamps to bounds", () => {
    expect(clampProductionPolicy(100)).toBe(25);
    expect(clampProductionPolicy(-100)).toBe(-25);
    expect(clampProductionPolicy(0)).toBe(0);
  });

  it("rounds to nearest integer", () => {
    expect(clampProductionPolicy(3.7)).toBe(4);
    expect(clampProductionPolicy(-2.3)).toBe(-2);
  });
});

describe("getRevenueMultiplier", () => {
  it("returns 1.10 at +25 (10% buff)", () => {
    expect(getRevenueMultiplier(25)).toBeCloseTo(1.1, 4);
  });

  it("returns 0.95 at -25 (5% penalty)", () => {
    expect(getRevenueMultiplier(-25)).toBeCloseTo(0.95, 4);
  });

  it("returns 1.0 at 0 (neutral)", () => {
    expect(getRevenueMultiplier(0)).toBe(1);
  });

  it("scales linearly for positive values", () => {
    expect(getRevenueMultiplier(12.5)).toBeCloseTo(1.05, 4);
  });

  it("scales linearly for negative values", () => {
    expect(getRevenueMultiplier(-12.5)).toBeCloseTo(0.975, 4);
  });
});

describe("getOutputMultiplier", () => {
  it("returns 1.15 at +25 (15% buff)", () => {
    expect(getOutputMultiplier(25)).toBeCloseTo(1.15, 4);
  });

  it("returns 0.90 at -25 (10% penalty)", () => {
    expect(getOutputMultiplier(-25)).toBeCloseTo(0.9, 4);
  });

  it("returns 1.0 at 0 (neutral)", () => {
    expect(getOutputMultiplier(0)).toBe(1);
  });

  it("scales linearly for positive values", () => {
    expect(getOutputMultiplier(12.5)).toBeCloseTo(1.075, 4);
  });

  it("scales linearly for negative values", () => {
    expect(getOutputMultiplier(-12.5)).toBeCloseTo(0.95, 4);
  });
});

describe("getInputMultiplier", () => {
  it("returns 1.10 at +25 (10% buff)", () => {
    expect(getInputMultiplier(25)).toBeCloseTo(1.1, 4);
  });

  it("returns 0.85 at -25 (15% penalty)", () => {
    expect(getInputMultiplier(-25)).toBeCloseTo(0.85, 4);
  });

  it("returns 1.0 at 0 (neutral)", () => {
    expect(getInputMultiplier(0)).toBe(1);
  });

  it("scales linearly for positive values", () => {
    expect(getInputMultiplier(12.5)).toBeCloseTo(1.05, 4);
  });

  it("scales linearly for negative values", () => {
    expect(getInputMultiplier(-12.5)).toBeCloseTo(0.925, 4);
  });
});

/**
 * Documents why NPP must not drive productionPolicy negative on a glut signal
 * (GH #3370 / 1953-default chronic-contraction audit). Player lean-ops at −25
 * is intentional (cut inputs harder than output to protect margins). When every
 * NPC sector does the same, commodity demand falls faster than supply and the
 * glut deepens — prices never recover, policy stays pinned at −25.
 */
describe("economy-wide contraction S/D feedback (lean-ops asymmetry)", () => {
  it("worsens a glut when producers and consumers all sit at −25", () => {
    const supply0 = 100;
    const demand0 = 80; // surplus share 20%
    const supply1 = supply0 * getOutputMultiplier(-25);
    const demand1 = demand0 * getInputMultiplier(-25);
    expect(supply0 / demand0).toBeCloseTo(1.25, 5);
    expect(supply1 / demand1).toBeGreaterThan(supply0 / demand0);
    expect(supply1 / demand1).toBeCloseTo(1.3235, 3);
  });
});

describe("getPolicyEffectInfo", () => {
  it("returns correct labels at +25", () => {
    const info = getPolicyEffectInfo(25);
    expect(info.revenue.label).toBe("+10%");
    expect(info.output.label).toBe("+15%");
    expect(info.input.label).toBe("+10%");
  });

  it("returns correct labels at -25", () => {
    const info = getPolicyEffectInfo(-25);
    expect(info.revenue.label).toBe("-5%");
    expect(info.output.label).toBe("-10%");
    expect(info.input.label).toBe("-15%");
  });

  it("returns correct labels at 0", () => {
    const info = getPolicyEffectInfo(0);
    expect(info.revenue.label).toBe("+0%");
    expect(info.output.label).toBe("+0%");
    expect(info.input.label).toBe("+0%");
  });
});
