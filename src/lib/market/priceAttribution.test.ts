import { describe, expect, it } from "vitest";
import { attributeCommodityPrice } from "./priceAttribution";

describe("attributeCommodityPrice", () => {
  it("reconciles every engine stage exactly to the applied price", () => {
    const result = attributeCommodityPrice({
      realBasePrice: 10,
      nominalBasePrice: 11,
      scarcityAdjustedBasePrice: 13.2,
      effectiveBasePrice: 15.6,
      marketTargetPrice: 18,
      driftedPrice: 16.2,
      appliedPrice: 20,
    });
    const explained =
      result.nominalInflation +
      result.scarcityMemory +
      result.producerInputCostPassThrough +
      result.marketBalance +
      result.adjustmentLag +
      result.explicitOverride;
    expect(explained).toBeCloseTo(result.appliedPrice - result.realBasePrice, 12);
    expect(result.nominalInflation).toBe(1);
    expect(result.scarcityMemory).toBeCloseTo(2.2, 12);
    expect(result.producerInputCostPassThrough).toBeCloseTo(2.4, 12);
    expect(result.marketBalance).toBeCloseTo(2.4, 12);
    expect(result.adjustmentLag).toBeCloseTo(-1.8, 12);
    expect(result.explicitOverride).toBeCloseTo(3.8, 12);
  });

  it("attributes an ordinary unpegged move without an override", () => {
    const result = attributeCommodityPrice({
      realBasePrice: 10,
      nominalBasePrice: 10,
      scarcityAdjustedBasePrice: 10,
      effectiveBasePrice: 10,
      marketTargetPrice: 14,
      driftedPrice: 11,
      appliedPrice: 11,
    });
    expect(result.marketBalance).toBe(4);
    expect(result.adjustmentLag).toBe(-3);
    expect(result.explicitOverride).toBe(0);
  });
});
