import { describe, expect, it } from "vitest";
import {
  buildCommodityOutputSnapshot,
  computeCommodityOutputSharePercent,
} from "./corpCommoditySnapshot";
import { COMMODITY_BASE_PRICES, dollarsToUnits } from "@/lib/constants/commodities";

type SnapshotSector = Parameters<typeof buildCommodityOutputSnapshot>[0][number];

const mkSector = (over: Partial<SnapshotSector>): SnapshotSector => ({
  sectorType: "manufacturing",
  revenue: 100_000,
  strategyId: "standard",
  transitionFromStrategyId: null,
  transitionStartTurn: null,
  ...over,
});

describe("buildCommodityOutputSnapshot", () => {
  it("records output units per supplied commodity", () => {
    const out = buildCommodityOutputSnapshot([mkSector({})], 10);
    expect(out.steel).toBeCloseTo(dollarsToUnits(100_000 * 0.4, COMMODITY_BASE_PRICES.steel), 1);
    expect(out.building_materials).toBeCloseTo(
      dollarsToUnits(100_000 * 0.2, COMMODITY_BASE_PRICES.building_materials),
      1
    );
    // Demand-only commodities are omitted.
    expect(out.energy).toBeUndefined();
  });

  it("aggregates output across sectors", () => {
    const out = buildCommodityOutputSnapshot(
      [mkSector({ revenue: 100_000 }), mkSector({ revenue: 50_000 })],
      10
    );
    expect(out.steel).toBeCloseTo(dollarsToUnits(150_000 * 0.4, COMMODITY_BASE_PRICES.steel), 1);
  });
});

describe("computeCommodityOutputSharePercent", () => {
  it("returns share capped at 100", () => {
    expect(computeCommodityOutputSharePercent(25, 100)).toBe(25);
    expect(computeCommodityOutputSharePercent(200, 100)).toBe(100);
    expect(computeCommodityOutputSharePercent(0, 100)).toBe(0);
  });
});
