import { describe, expect, it } from "vitest";
import {
  calculatePlantSectorSplit,
  didPlantSectorSplitSucceed,
  FIXED_PLANT_SPLIT_FRACTION,
} from "./plantSectorSplit";

describe("calculatePlantSectorSplit", () => {
  it("always sizes the attempt at a fixed 1 percent and leaves one plant", () => {
    expect(FIXED_PLANT_SPLIT_FRACTION).toBe(0.01);
    expect(calculatePlantSectorSplit({
      defenderPlantCount: 10_000,
      defenderBookValueAnchor: 2_000_000,
      attackerMarketingStrength: 100,
      defenderMarketingStrength: 100,
    }).plantsAtRisk).toBe(100);

    expect(calculatePlantSectorSplit({
      defenderPlantCount: 50,
      defenderBookValueAnchor: 50_000,
      attackerMarketingStrength: 100,
      defenderMarketingStrength: 100,
    }).plantsAtRisk).toBe(1);

    expect(calculatePlantSectorSplit({
      defenderPlantCount: 1,
      defenderBookValueAnchor: 1_000,
      attackerMarketingStrength: 100,
      defenderMarketingStrength: 100,
    }).plantsAtRisk).toBe(0);
  });

  it("compares pre-attempt MS and clamps odds to 5 through 95 percent", () => {
    expect(calculatePlantSectorSplit({
      defenderPlantCount: 100,
      defenderBookValueAnchor: 100_000,
      attackerMarketingStrength: 100,
      defenderMarketingStrength: 100,
    }).successProbability).toBe(0.5);

    expect(calculatePlantSectorSplit({
      defenderPlantCount: 100,
      defenderBookValueAnchor: 100_000,
      attackerMarketingStrength: 10_000,
      defenderMarketingStrength: 0,
    }).successProbability).toBe(0.95);

    expect(calculatePlantSectorSplit({
      defenderPlantCount: 100,
      defenderBookValueAnchor: 100_000,
      attackerMarketingStrength: 0,
      defenderMarketingStrength: 10_000,
    }).successProbability).toBe(0.05);
  });

  it("charges cash from tranche book value and MS from total sector size", () => {
    const result = calculatePlantSectorSplit({
      defenderPlantCount: 1_000,
      defenderBookValueAnchor: 2_000_000,
      attackerMarketingStrength: 100,
      defenderMarketingStrength: 100,
    });

    expect(result.plantsAtRisk).toBe(10);
    expect(result.trancheBookValueAnchor).toBe(20_000);
    expect(result.cashCostAnchor).toBe(10_000);
    expect(result.marketingStrengthCost).toBe(20);
  });

  it("normalizes invalid economic inputs without producing negative costs", () => {
    const result = calculatePlantSectorSplit({
      defenderPlantCount: Number.NaN,
      defenderBookValueAnchor: -100,
      attackerMarketingStrength: -10,
      defenderMarketingStrength: Number.POSITIVE_INFINITY,
    });

    expect(result).toEqual({
      plantsAtRisk: 0,
      trancheBookValueAnchor: 0,
      cashCostAnchor: 0,
      marketingStrengthCost: 0,
      successProbability: 0.5,
    });
  });
});

describe("didPlantSectorSplitSucceed", () => {
  it("uses a zero-inclusive, one-exclusive random roll", () => {
    expect(didPlantSectorSplitSucceed(0.5, 0)).toBe(true);
    expect(didPlantSectorSplitSucceed(0.5, 0.499999)).toBe(true);
    expect(didPlantSectorSplitSucceed(0.5, 0.5)).toBe(false);
    expect(didPlantSectorSplitSucceed(0.5, 0.999999)).toBe(false);
  });

  it("rejects invalid rolls", () => {
    expect(() => didPlantSectorSplitSucceed(0.5, -0.01)).toThrow(RangeError);
    expect(() => didPlantSectorSplitSucceed(0.5, 1)).toThrow(RangeError);
    expect(() => didPlantSectorSplitSucceed(0.5, Number.NaN)).toThrow(RangeError);
  });
});
