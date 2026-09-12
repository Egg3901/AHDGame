import { describe, it, expect } from "vitest";
import { sectorDemandGapUnits } from "./sectorDemandGap";
import {
  COMMODITY_BASE_PRICES,
  commodityMixWeight,
  type CommodityType,
} from "@/lib/constants/commodities";

describe("sectorDemandGapUnits", () => {
  it("averages over output legs, so one balanced line no longer vetoes expansion", () => {
    // Chemicals deeply short, plastics balanced: the old min read 0 and the
    // plant sorted last. The rate-weighted mean answers the chemicals leg.
    const mix: Partial<Record<CommodityType, number>> = { chemicals: 0.5, plastics: 0.15 };
    const chemGap = 100_000;
    const gap = sectorDemandGapUnits(mix, (c) => (c === "chemicals" ? chemGap : 0));
    const chemWeight = commodityMixWeight(mix, COMMODITY_BASE_PRICES, "chemicals");
    const expected = (0.5 * (chemGap / chemWeight)) / 0.65;
    expect(gap).toBeCloseTo(expected, 6);
    expect(gap).toBeGreaterThan(0);
    // Mean, not max: the balanced leg pulls the quote below the deep leg alone.
    expect(gap).toBeLessThan(chemGap / chemWeight);
  });

  it("still reads ~0 for a uniformly glutted mix", () => {
    const mix: Partial<Record<CommodityType, number>> = { chemicals: 0.5, plastics: 0.15 };
    expect(sectorDemandGapUnits(mix, () => -1000)).toBe(0);
    expect(sectorDemandGapUnits(mix, () => 0)).toBe(0);
  });

  it("scales the binding leg's gap by its mix weight", () => {
    const mix: Partial<Record<CommodityType, number>> = { food: 0.5 };
    // Single leg: weight is 1, so the sector-unit gap equals the commodity gap.
    expect(sectorDemandGapUnits(mix, () => 500)).toBeCloseTo(500, 6);
  });

  it("clamps a negative gap (a glut) to zero rather than going negative", () => {
    const mix: Partial<Record<CommodityType, number>> = { food: 0.5 };
    expect(sectorDemandGapUnits(mix, () => -6_711_230)).toBe(0);
  });

  it("returns 0 for a mix with no positive-rate legs", () => {
    expect(sectorDemandGapUnits({}, () => 1000)).toBe(0);
    expect(sectorDemandGapUnits({ food: 0 }, () => 1000)).toBe(0);
  });

  it("reproduces ticket #1077: a globally glutted leg no longer zeroes a short market", () => {
    // Live prod turn 97: world oil read 0.82 D/S so the old global gate quoted
    // "0 room", while the US-reachable book ran 1.82 with 79,092 units unmet.
    const mix: Partial<Record<CommodityType, number>> = { oil: 1 };
    const globalGap = 357_531.82 - 435_641.73;
    const reachableGap = 79_092;
    expect(sectorDemandGapUnits(mix, () => globalGap)).toBe(0);
    expect(sectorDemandGapUnits(mix, () => reachableGap)).toBeGreaterThan(0);
  });
});
