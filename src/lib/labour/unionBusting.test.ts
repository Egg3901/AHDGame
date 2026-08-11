import { describe, expect, it } from "vitest";
import {
  calculateUnionBustingSuccessChance,
  rollUnionBustingOutcome,
  applyUnionBustingOutcome,
  unionBustingCashCost,
  BUSTING_SUCCESS_UNIONIZATION_DROP,
  BUSTING_BACKFIRE_UNIONIZATION_SPIKE,
  BUSTING_MIN_COST,
  BUSTING_COST_REVENUE_FRACTION,
} from "./unionBusting";

describe("calculateUnionBustingSuccessChance", () => {
  it("is highest at unionization 0", () => {
    const out = calculateUnionBustingSuccessChance(0);
    expect(out.finalChance).toBe(60);
    expect(out.unionizationPenalty).toBe(0);
  });

  it("decreases as unionization rises (harder to bust an organized shop)", () => {
    const low = calculateUnionBustingSuccessChance(10);
    const high = calculateUnionBustingSuccessChance(80);
    expect(high.finalChance).toBeLessThan(low.finalChance);
  });

  it("clamps to the minimum success chance at extreme unionization", () => {
    const out = calculateUnionBustingSuccessChance(100);
    expect(out.finalChance).toBeGreaterThanOrEqual(20);
  });

  it("treats out-of-range / non-finite unionization as clamped", () => {
    expect(calculateUnionBustingSuccessChance(-10).finalChance).toBe(
      calculateUnionBustingSuccessChance(0).finalChance
    );
    expect(calculateUnionBustingSuccessChance(NaN).finalChance).toBe(
      calculateUnionBustingSuccessChance(0).finalChance
    );
  });
});

describe("rollUnionBustingOutcome", () => {
  it("succeeds when the roll is at or below the final chance", () => {
    expect(rollUnionBustingOutcome(60, 1)).toBe(true);
    expect(rollUnionBustingOutcome(60, 60)).toBe(true);
  });

  it("fails when the roll exceeds the final chance", () => {
    expect(rollUnionBustingOutcome(60, 61)).toBe(false);
    expect(rollUnionBustingOutcome(60, 100)).toBe(false);
  });
});

describe("applyUnionBustingOutcome", () => {
  it("drops unionization by BUSTING_SUCCESS_UNIONIZATION_DROP on success", () => {
    expect(applyUnionBustingOutcome(50, true)).toBe(50 - BUSTING_SUCCESS_UNIONIZATION_DROP);
  });

  it("raises unionization by BUSTING_BACKFIRE_UNIONIZATION_SPIKE on backfire", () => {
    expect(applyUnionBustingOutcome(50, false)).toBe(50 + BUSTING_BACKFIRE_UNIONIZATION_SPIKE);
  });

  it("clamps to [0,100]", () => {
    expect(applyUnionBustingOutcome(5, true)).toBe(0);
    expect(applyUnionBustingOutcome(95, false)).toBe(100);
  });
});

describe("unionBustingCashCost", () => {
  it("is a fraction of daily revenue", () => {
    expect(unionBustingCashCost(10000)).toBe(10000 * BUSTING_COST_REVENUE_FRACTION);
  });

  it("floors at BUSTING_MIN_COST for tiny/zero revenue", () => {
    expect(unionBustingCashCost(0)).toBe(BUSTING_MIN_COST);
    expect(unionBustingCashCost(100)).toBe(BUSTING_MIN_COST);
  });

  it("treats negative/non-finite revenue as 0", () => {
    expect(unionBustingCashCost(-500)).toBe(BUSTING_MIN_COST);
    expect(unionBustingCashCost(NaN)).toBe(BUSTING_MIN_COST);
  });
});
