import { describe, it, expect } from "vitest";
import {
  computeOrderFlowMultiplier,
  ORDER_FLOW_CAP,
  ORDER_FLOW_MEAN_REVERSION,
} from "./orderFlowEngine";
import { MIN_ORDER_FLOW_FLOAT_FRACTION as MARKET_MIN_FLOAT_FRACTION } from "./marketExecution";

function compute(
  opts: {
    buy?: number;
    sell?: number;
    float?: number;
    price?: number;
    shares?: number;
    prev?: number;
  } = {}
): number {
  return computeOrderFlowMultiplier(
    opts.buy ?? 0,
    opts.sell ?? 0,
    opts.float ?? 1_000_000,
    opts.price ?? 10,
    opts.shares ?? 10_000_000,
    opts.prev ?? 1.0
  );
}

describe("computeOrderFlowMultiplier", () => {
  it("returns 1.0 with no activity and neutral prior", () => {
    expect(compute()).toBe(1.0);
  });

  it("mean-reverts prior toward 1.0 by 20% each interval (positive prior)", () => {
    // prev = 1.10, no new pressure: carry = 0.10 × 0.80 = 0.08 → 1.08
    const result = compute({ prev: 1.1 });
    expect(result).toBeCloseTo(1 + 0.1 * ORDER_FLOW_MEAN_REVERSION, 6);
  });

  it("mean-reverts negative prior toward 1.0", () => {
    // prev = 0.92, no new pressure: carry = -0.08 × 0.80 = -0.064 → 0.936
    const result = compute({ prev: 0.92 });
    expect(result).toBeCloseTo(1 + -0.08 * ORDER_FLOW_MEAN_REVERSION, 6);
  });

  it("buy pressure pushes multiplier above 1.0", () => {
    const result = compute({ buy: 500_000 });
    expect(result).toBeGreaterThan(1.0);
  });

  it("sell pressure pushes multiplier below 1.0", () => {
    const result = compute({ sell: 500_000 });
    expect(result).toBeLessThan(1.0);
  });

  it("net pressure is zero when buy equals sell", () => {
    // Only carry from neutral prior → stays 1.0
    const result = compute({ buy: 100_000, sell: 100_000 });
    expect(result).toBeCloseTo(1.0, 6);
  });

  it("clamps result to +ORDER_FLOW_CAP", () => {
    const result = compute({ buy: 1_000_000_000, float: 60_000, price: 1, shares: 1_000_000 });
    expect(result).toBeCloseTo(1 + ORDER_FLOW_CAP, 4);
  });

  it("clamps result to -ORDER_FLOW_CAP", () => {
    const result = compute({ sell: 1_000_000_000, float: 60_000, price: 1, shares: 1_000_000 });
    expect(result).toBeCloseTo(1 - ORDER_FLOW_CAP, 4);
  });

  it("carries over prior pressure (stacked buy)", () => {
    const withCarry = compute({ buy: 200_000, prev: 1.08 });
    const withoutCarry = compute({ buy: 200_000, prev: 1.0 });
    expect(withCarry).toBeGreaterThan(withoutCarry);
  });

  it("returns 1.0 when float is zero (guard)", () => {
    const result = compute({ float: 0 });
    expect(result).toBe(1.0);
  });

  it("thin float amplifies pressure (liquidityFactor closer to 1)", () => {
    const thinFloat = compute({
      buy: 100_000,
      float: 600_000,
      price: 10,
      shares: 10_000_000,
    });
    const thickFloat = compute({ buy: 100_000, float: 5_000_000, price: 10, shares: 10_000_000 });
    expect(thinFloat).toBeGreaterThan(thickFloat);
  });

  it("disables order-flow pricing below the minimum float fraction", () => {
    const result = compute({
      buy: 1_000_000_000,
      float: 499_999,
      price: 10,
      shares: 10_000_000,
      prev: 1.12,
    });
    expect(MARKET_MIN_FLOAT_FRACTION).toBe(0.05);
    expect(result).toBe(1.0);
  });
});
