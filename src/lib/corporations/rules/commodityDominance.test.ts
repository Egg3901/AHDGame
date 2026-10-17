import { describe, expect, it } from "vitest";
import { computeBuildCost, CAPACITY_ANCHOR_YEAR } from "@/lib/constants/capacityEconomy";
import { SECTOR_SUPPLY } from "@/lib/constants/commodities";
import { NEUTRAL_STAT } from "@/lib/stats/statsConstants";
import {
  COMMODITY_DOMINANCE_MULT_AT_DOUBLE,
  COMMODITY_DOMINANCE_MULT_AT_PARITY,
  DUMPING_GUARD_SOLD_SHARE,
  commodityDominanceMultiplier,
  commodityDominanceRatio,
  dominanceMultiplierForOrder,
  guardedPricingPosture,
  isDumpingGuarded,
  type CommodityDominanceSector,
} from "./commodityDominance";

describe("commodity dominance ramp", () => {
  it("is 1x up to half of world demand", () => {
    expect(commodityDominanceMultiplier(0)).toBe(1);
    expect(commodityDominanceMultiplier(0.25)).toBe(1);
    expect(commodityDominanceMultiplier(0.5)).toBe(1);
  });

  it("hits the named anchors", () => {
    expect(commodityDominanceMultiplier(1)).toBe(COMMODITY_DOMINANCE_MULT_AT_PARITY);
    expect(commodityDominanceMultiplier(2)).toBe(COMMODITY_DOMINANCE_MULT_AT_DOUBLE);
    expect(commodityDominanceMultiplier(0.75)).toBeCloseTo(2, 10);
    expect(commodityDominanceMultiplier(1.5)).toBeCloseTo(6.5, 10);
  });

  it("keeps growing, convexly, beyond double demand", () => {
    const at3 = commodityDominanceMultiplier(3);
    const at4 = commodityDominanceMultiplier(4);
    const at5 = commodityDominanceMultiplier(5);
    expect(at3).toBeGreaterThan(COMMODITY_DOMINANCE_MULT_AT_DOUBLE);
    expect(at5).toBeGreaterThanOrEqual(10);
    expect(at4 - at3).toBeLessThan(at5 - at4);
  });

  it("is monotone and continuous across segment joins", () => {
    let prev = 1;
    for (let r = 0; r <= 6; r += 0.01) {
      const m = commodityDominanceMultiplier(r);
      expect(m).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = m;
    }
    expect(commodityDominanceMultiplier(1.0000001)).toBeCloseTo(3, 4);
    expect(commodityDominanceMultiplier(2.0000001)).toBeCloseTo(10, 4);
  });

  it("treats junk input as no toll", () => {
    expect(commodityDominanceMultiplier(Number.NaN)).toBe(1);
    expect(commodityDominanceMultiplier(-3)).toBe(1);
  });
});

const baseInputs = {
  sectorType: "retail" as const,
  units: 100,
  strategyId: null,
  year: CAPACITY_ANCHOR_YEAR,
  preset: "2019-default",
  eraUnitScale: 1,
  marketSharePercent: 0,
  nationalMarketSharePercent: 0,
  primeRate: 0,
  acumen: NEUTRAL_STAT,
  hostCostOfLivingIndex: null,
  founding: false,
};

describe("computeBuildCost with the commodity toll", () => {
  it("quotes a firm at 5x world demand at least 10x a small firm", () => {
    const small = computeBuildCost({ ...baseInputs, commodityDominanceRatio: 0.1 });
    const huge = computeBuildCost({ ...baseInputs, commodityDominanceRatio: 5 });
    expect(huge.totalAnchor / small.totalAnchor).toBeGreaterThanOrEqual(10);
    expect(huge.dominanceMultiplier).toBeGreaterThanOrEqual(10);
    expect(huge.commodityDominanceMultiplier).toBe(huge.dominanceMultiplier);
  });

  it("leaves a small firm exactly as before", () => {
    const before = computeBuildCost(baseInputs);
    const small = computeBuildCost({ ...baseInputs, commodityDominanceRatio: 0.4 });
    expect(small).toEqual(before);
    expect(small.commodityDominanceMultiplier).toBe(1);
  });

  it("uses the harsher of the local and commodity tolls, with no density or shield discount", () => {
    const local = computeBuildCost({
      ...baseInputs,
      marketSharePercent: 100,
      competitorCount: 0,
    });
    expect(local.dominanceMultiplier).toBeLessThan(3);
    const both = computeBuildCost({
      ...baseInputs,
      marketSharePercent: 100,
      competitorCount: 0,
      techDominanceShield: 0.9,
      commodityDominanceRatio: 1,
    });
    expect(both.dominanceMultiplier).toBe(3);
  });

  it("prices an order by the ratio after it lands", () => {
    const models = [
      {
        commodity: "retail",
        label: "Retail",
        demandUnits: 1000,
        potentialUnits: 400,
        yieldPerUnit: 1,
      },
    ];
    expect(dominanceMultiplierForOrder({ localMultiplier: 1, models, units: 50 })).toBe(1);
    expect(dominanceMultiplierForOrder({ localMultiplier: 1, models, units: 600 })).toBe(3);
    expect(dominanceMultiplierForOrder({ localMultiplier: 4, models, units: 600 })).toBe(4);
  });
});

describe("commodityDominanceRatio", () => {
  const commodity = SECTOR_SUPPLY.retail?.[0]?.commodity ?? "retail";
  const sector = (id: string, capitalStock: number, queuedUnits = 0): CommodityDominanceSector => ({
    _id: id,
    sectorType: "retail",
    capitalStock,
    queuedUnits,
    strategyId: null,
  });

  it("counts owned capacity, queued units and the new order", () => {
    const sectors = [sector("a", 100), sector("b", 50, 25)];
    const args = {
      sectors,
      commodities: [commodity],
      targetSectorId: "a",
      isNatcorp: false,
      turn: 10,
      demandOf: () => 1,
    };
    const none = commodityDominanceRatio({ ...args, extraUnits: 0 });
    const more = commodityDominanceRatio({ ...args, extraUnits: 100 });
    expect(none.commodity).toBe(commodity);
    expect(none.ratio).toBeGreaterThan(0);
    // 150 owned + 25 queued, then +100 on the target sector.
    expect(more.ratio / none.ratio).toBeCloseTo(275 / 175, 6);
  });

  it("skips commodities with no known demand", () => {
    const result = commodityDominanceRatio({
      sectors: [sector("a", 1e9)],
      commodities: [commodity],
      targetSectorId: "a",
      extraUnits: 1e9,
      isNatcorp: false,
      turn: 10,
      demandOf: () => null,
    });
    expect(result).toEqual({ ratio: 0, commodity: null });
  });
});

describe("dumping guard", () => {
  it("guards a firm above half of world supply only", () => {
    expect(DUMPING_GUARD_SOLD_SHARE).toBe(0.5);
    expect(isDumpingGuarded(65, 100)).toBe(true);
    expect(isDumpingGuarded(50, 100)).toBe(false);
    expect(isDumpingGuarded(10, 100)).toBe(false);
    expect(isDumpingGuarded(10, 0)).toBe(false);
  });

  it("floors negative posture at zero and leaves everything else alone", () => {
    expect(guardedPricingPosture(-0.2, true)).toBe(0);
    expect(guardedPricingPosture(0.15, true)).toBe(0.15);
    expect(guardedPricingPosture(-0.2, false)).toBe(-0.2);
  });
});
