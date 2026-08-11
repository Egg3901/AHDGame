import { describe, it, expect } from "vitest";
import { savingsFlowPressureRatio, SAVINGS_STOCK_DENOMINATOR_FLOOR } from "./savingsFlowPressure";

describe("savingsFlowPressureRatio", () => {
  it("returns 0 when there is no net flow", () => {
    expect(savingsFlowPressureRatio(0, 0, 0)).toBe(0);
    expect(savingsFlowPressureRatio(0, 1_000_000, 50_000)).toBe(0);
  });

  it("clamps extreme net flow against the stock denominator floor", () => {
    const r = savingsFlowPressureRatio(50_000_000, 200_000_000, 100_000);
    expect(r).toBeLessThanOrEqual(1);
    expect(r).toBeGreaterThan(0);
    expect(r).toBeCloseTo(
      50_000_000 / Math.max(100_000, SAVINGS_STOCK_DENOMINATOR_FLOOR, 50_000_000),
      6
    );
  });

  it("uses gross-flow churn floor when stock is tiny but activity is large", () => {
    const gross = 40_000_000;
    const net = 10_000_000;
    const denom = Math.max(200_000, SAVINGS_STOCK_DENOMINATOR_FLOOR, gross * 0.25);
    expect(savingsFlowPressureRatio(net, gross, 200_000)).toBeCloseTo(net / denom, 6);
  });

  it("clamps to -1 and +1", () => {
    expect(savingsFlowPressureRatio(9e15, 9e15, 1)).toBe(1);
    expect(savingsFlowPressureRatio(-9e15, 9e15, 1)).toBe(-1);
  });
});
