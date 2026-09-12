import { describe, expect, it } from "vitest";
import { computeGlobalCommodityPrice } from "./globalCommodityPrice";

describe("computeGlobalCommodityPrice", () => {
  it("preserves drift and reconciles its attribution", () => {
    const result = computeGlobalCommodityPrice({
      realBasePrice: 10,
      nominalIndex: 1,
      scarcityMultiplier: 1,
      costPassThroughMultiplier: 1,
      supply: 100,
      demand: 200,
      priceKnee: 3,
      previousPrice: 10,
    });
    expect(result.appliedPrice).toBeGreaterThan(10);
    const a = result.attribution;
    expect(
      a.nominalInflation +
        a.scarcityMemory +
        a.producerInputCostPassThrough +
        a.marketBalance +
        a.adjustmentLag +
        a.explicitOverride
    ).toBeCloseTo(a.appliedPrice - a.realBasePrice, 12);
  });

  it("keeps hard-peg precedence and attributes the override", () => {
    const result = computeGlobalCommodityPrice({
      realBasePrice: 10,
      nominalIndex: 1,
      scarcityMultiplier: 1,
      costPassThroughMultiplier: 1,
      supply: 100,
      demand: 200,
      priceKnee: 3,
      previousPrice: 10,
      hardPeg: 7,
      nudge: 99,
    });
    expect(result.appliedPrice).toBe(7);
    expect(result.attribution.explicitOverride).not.toBe(0);
  });
});
