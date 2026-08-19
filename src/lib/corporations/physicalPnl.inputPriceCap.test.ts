import { describe, it, expect } from "vitest";
import type { CommodityType } from "@/lib/constants/commodities";
import { priceRealizationFactor } from "@/lib/market/priceRealization";
import { capInputPriceRatioAtWorld, computeInputsCost } from "./physicalPnl";

describe("capInputPriceRatioAtWorld", () => {
  it("caps a hot reachable book at the world ratio (ticket-1120 US iron)", () => {
    // Live t180: US iron reachable ~3.273 vs world ~0.767.
    expect(capInputPriceRatioAtWorld(0.767, 3.273)).toBeCloseTo(0.767);
  });

  it("keeps a cheap reachable discount below world (fertilizer)", () => {
    // Live: world fertilizer ~2.38 vs US reachable ~1.08.
    expect(capInputPriceRatioAtWorld(2.38, 1.08)).toBeCloseTo(1.08);
  });

  it("uses reachable when the world ratio is missing", () => {
    expect(capInputPriceRatioAtWorld(undefined, 1.5)).toBe(1.5);
  });

  it("uses reachable when the world ratio is non-finite", () => {
    expect(capInputPriceRatioAtWorld(Number.NaN, 1.5)).toBe(1.5);
  });
});

describe("computeInputsCost — world-capped input ratios", () => {
  it("bills iron at the world-capped ratio, not the hot reachable print", () => {
    const basePrices = { iron: 100 } as Record<CommodityType, number>;
    const args = {
      nominalDailyRevenue: 1000,
      rates: { iron: 0.15 } as Partial<Record<CommodityType, number>>,
      basePrices,
      utilization: 1,
      inputMultiplier: 1,
      turnsPerDay: 4,
    };
    const uncapped = computeInputsCost({
      ...args,
      priceRatios: new Map([["iron" as CommodityType, 3.273]]),
    });
    const capped = computeInputsCost({
      ...args,
      priceRatios: new Map([["iron" as CommodityType, capInputPriceRatioAtWorld(0.767, 3.273)]]),
    });
    // units = (1000 * 0.15 / 100 / 4) = 0.375. Since #379 the bill prices each
    // unit through priceRealizationFactor(ratio) (clamp(ratio^0.5, 0.7, 1.5)),
    // the same damping revenue uses, so the ratio enters non-linearly. The cap
    // still matters: it lowers the ratio fed into that factor (1.5 -> 0.876),
    // which is what this test protects.
    expect(uncapped.total).toBeCloseTo(0.375 * 100 * priceRealizationFactor(3.273));
    expect(capped.total).toBeCloseTo(0.375 * 100 * priceRealizationFactor(0.767));
    expect(capped.total).toBeLessThan(uncapped.total);
  });
});
