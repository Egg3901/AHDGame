import { describe, it, expect } from "vitest";
import { COMMODITY_BASE_PRICES, type CommodityType } from "@/lib/constants/commodities";
import { impliedOutputUnits } from "@/lib/market/capital";
import { getStrategy, SECTOR_STRATEGIES } from "@/lib/constants/sectorStrategies";
import type { CorporationType } from "@/lib/constants/corporations";
import {
  capacityRescaleRatio,
  rescaleBuildQueueForStrategyChange,
  rescaleCapacityForStrategyChange,
  revenuePerCapacityUnit,
  revenuePerCapacityUnitForStrategy,
  techOutputUnitsMultiplier,
  unitYieldForSupply,
} from "./capacityEconomy";

/**
 * D9 — "capacity is ONE currency."
 *
 * `capitalStock` counts output units/day, and the build price is quoted against
 * the sector's DEFAULT strategy, so capacity has one price regardless of what a
 * corp later points it at. The counterpart obligation is that the STOCK must be
 * renormalized whenever the production mix changes, or the same physical plant
 * silently changes value by the ratio of the two mixes' revenue-per-unit.
 */

/** Revenue one unit of capacity earns on a given mix — the plants `mixPrice`. */
function mixPriceOf(sectorType: CorporationType, strategyId: string): number {
  const supply = getStrategy(sectorType, strategyId).supply as Partial<
    Record<CommodityType, number>
  >;
  const probeRevenue = 1_000_000;
  return probeRevenue / impliedOutputUnits(probeRevenue, supply, COMMODITY_BASE_PRICES, 1);
}

describe("D9 — RPU per strategy", () => {
  it("agrees with the engine's own mixPrice (revenue ÷ impliedOutputUnits)", () => {
    for (const sectorType of ["extraction", "manufacturing", "energy"] as CorporationType[]) {
      for (const strategy of SECTOR_STRATEGIES[sectorType] ?? []) {
        expect(revenuePerCapacityUnitForStrategy(sectorType, strategy.id, 1)).toBeCloseTo(
          mixPriceOf(sectorType, strategy.id),
          6
        );
      }
    }
  });

  it("reduces to the default-strategy anchor for the default strategy", () => {
    expect(revenuePerCapacityUnitForStrategy("manufacturing", "standard", 1)).toBeCloseTo(
      revenuePerCapacityUnit("manufacturing", 1),
      9
    );
    expect(revenuePerCapacityUnitForStrategy("manufacturing", null, 1)).toBeCloseTo(
      revenuePerCapacityUnit("manufacturing", 1),
      9
    );
  });

  it("documents the hazard it exists to close — extraction mixes differ ~140x", () => {
    const coal = revenuePerCapacityUnitForStrategy("extraction", "coal_mining", 1);
    const rareEarth = revenuePerCapacityUnitForStrategy("extraction", "rare_earth_mining", 1);
    // Not a tolerance — an order-of-magnitude claim. Un-normalized, a retool
    // between these two would re-price the very same plant by this factor.
    expect(rareEarth / coal).toBeGreaterThan(100);
  });

  it("unitYieldForSupply is the reciprocal of RPU", () => {
    const supply = getStrategy("extraction", "oil_gas").supply as Partial<
      Record<CommodityType, number>
    >;
    expect(1 / unitYieldForSupply(supply, 1)).toBeCloseTo(
      revenuePerCapacityUnitForStrategy("extraction", "oil_gas", 1),
      9
    );
  });
});

describe("D9 — rescaleCapacityForStrategyChange", () => {
  const CASES: Array<[CorporationType, string, string]> = [
    ["extraction", "coal_mining", "rare_earth_mining"],
    ["extraction", "rare_earth_mining", "coal_mining"],
    ["extraction", "standard", "timber_logging"],
    ["manufacturing", "standard", "heavy_metals"],
    ["energy", "fracking", "renewables"],
  ];

  it.each(CASES)("keeps the nameplate invariant across %s %s -> %s", (type, from, to) => {
    const stockBefore = 4_321;
    const nameplateBefore = stockBefore * mixPriceOf(type, from);
    const stockAfter = rescaleCapacityForStrategyChange(stockBefore, type, from, to);
    const nameplateAfter = stockAfter * mixPriceOf(type, to);
    expect(nameplateAfter).toBeCloseTo(nameplateBefore, 6);
  });

  it("is exactly reversible — retooling and changing your mind mints nothing", () => {
    const stock = 12_345.678;
    const out = rescaleCapacityForStrategyChange(
      rescaleCapacityForStrategyChange(stock, "extraction", "standard", "rare_earth_mining"),
      "extraction",
      "rare_earth_mining",
      "standard"
    );
    expect(out).toBeCloseTo(stock, 6);
  });

  it("is a no-op when the strategy does not actually change", () => {
    expect(capacityRescaleRatio("extraction", "coal_mining", "coal_mining")).toBe(1);
    expect(capacityRescaleRatio("manufacturing", null, "standard")).toBe(1);
    expect(capacityRescaleRatio("manufacturing", undefined, undefined)).toBe(1);
  });

  it("leaves a sector with no capacity alone", () => {
    expect(rescaleCapacityForStrategyChange(0, "extraction", "standard", "coal_mining")).toBe(0);
    expect(rescaleCapacityForStrategyChange(null, "extraction", "standard", "coal_mining")).toBe(0);
    expect(
      rescaleCapacityForStrategyChange(Number.NaN, "extraction", "standard", "coal_mining")
    ).toBe(0);
  });

  it("degrades to a no-op for a sector type with no strategy table", () => {
    // `getStrategy` throws on an unknown type. These functions run inside
    // player-facing retool routes, where a legacy/garbage sectorType must mean
    // "do not rescale", never a 500.
    const unknown = "not_a_sector_type" as CorporationType;
    expect(() => capacityRescaleRatio(unknown, "standard", "coal_mining")).not.toThrow();
    expect(capacityRescaleRatio(unknown, "standard", "coal_mining")).toBe(1);
    expect(rescaleCapacityForStrategyChange(500, unknown, "standard", "coal_mining")).toBe(500);
  });

  it("degrades to 1 rather than 0/Infinity for an unpriced mix", () => {
    // `getStrategy` falls back to the sector's first strategy for an unknown id,
    // so the ratio stays finite and positive whatever is passed.
    const ratio = capacityRescaleRatio("extraction", "not_a_strategy", "also_not_one");
    expect(Number.isFinite(ratio)).toBe(true);
    expect(ratio).toBeGreaterThan(0);
  });
});

describe("D9 — build orders in flight", () => {
  const QUEUE = [
    { unitsOrdered: 100, costPaidAnchor: 500_000, startTurn: 10, onlineTurn: 106 },
    { unitsOrdered: 50, costPaidAnchor: 0, startTurn: 12, onlineTurn: 60 },
  ];

  it("rescales unitsOrdered by the same ratio the stock moves by", () => {
    const ratio = capacityRescaleRatio("extraction", "coal_mining", "rare_earth_mining");
    const out = rescaleBuildQueueForStrategyChange(QUEUE, ratio);
    expect(out[0].unitsOrdered).toBeCloseTo(100 * ratio, 9);
    expect(out[1].unitsOrdered).toBeCloseTo(50 * ratio, 9);
  });

  it("never touches costPaidAnchor — CIP and the refund must report cash actually paid", () => {
    const ratio = capacityRescaleRatio("extraction", "coal_mining", "rare_earth_mining");
    const out = rescaleBuildQueueForStrategyChange(QUEUE, ratio);
    expect(out.map((o) => o.costPaidAnchor)).toEqual([500_000, 0]);
    expect(out.map((o) => o.onlineTurn)).toEqual([106, 60]);
  });

  it("an order that lands after a retool delivers the nameplate it was bought for", () => {
    // 100 units ordered on the coal mix are worth 100 x coalMixPrice of output.
    // After the retool they must still be worth that much, priced on the new mix.
    const ratio = capacityRescaleRatio("extraction", "coal_mining", "rare_earth_mining");
    const [order] = rescaleBuildQueueForStrategyChange(QUEUE, ratio);
    expect(order.unitsOrdered * mixPriceOf("extraction", "rare_earth_mining")).toBeCloseTo(
      100 * mixPriceOf("extraction", "coal_mining"),
      3
    );
  });

  it("returns a copy, never mutating the caller's queue", () => {
    const original = QUEUE.map((o) => ({ ...o }));
    rescaleBuildQueueForStrategyChange(original, 7);
    expect(original[0].unitsOrdered).toBe(100);
  });

  it("handles an absent or empty queue", () => {
    expect(rescaleBuildQueueForStrategyChange(null, 2)).toEqual([]);
    expect(rescaleBuildQueueForStrategyChange([], 2)).toEqual([]);
  });
});

describe("techOutputUnitsMultiplier", () => {
  const SUPPLY = getStrategy("manufacturing", "standard").supply as Partial<
    Record<CommodityType, number>
  >;

  it("is exactly 1 with no tech effects — the flip identity depends on it", () => {
    expect(techOutputUnitsMultiplier(SUPPLY, {})).toBe(1);
    expect(techOutputUnitsMultiplier(SUPPLY, undefined)).toBe(1);
    expect(techOutputUnitsMultiplier(SUPPLY, null)).toBe(1);
  });

  it("passes a uniform multiplier straight through", () => {
    const uniform: Record<string, number> = {};
    for (const c of Object.keys(SUPPLY)) uniform[c] = 1.2;
    expect(techOutputUnitsMultiplier(SUPPLY, uniform)).toBeCloseTo(1.2, 9);
  });

  it("weights a single-commodity boost by that leg's share of unit count", () => {
    const commodity = Object.keys(SUPPLY)[0] as CommodityType;
    const mult = techOutputUnitsMultiplier(SUPPLY, { [commodity]: 2 });
    // Strictly between "no effect" and "the whole mix doubled".
    expect(mult).toBeGreaterThan(1);
    expect(mult).toBeLessThanOrEqual(2);
    // And it equals the ratio the engine would get by scaling that rate directly.
    const scaled = { ...SUPPLY, [commodity]: (SUPPLY[commodity] ?? 0) * 2 };
    expect(mult).toBeCloseTo(unitYieldForSupply(scaled, 1) / unitYieldForSupply(SUPPLY, 1), 9);
  });

  it("ignores multipliers for commodities the sector does not produce", () => {
    expect(techOutputUnitsMultiplier(SUPPLY, { unobtainium: 10 })).toBeCloseTo(1, 9);
  });

  it("is 1 for a sector with no priced output at all", () => {
    expect(techOutputUnitsMultiplier({}, { steel: 2 })).toBe(1);
  });
});
