import { describe, expect, it } from "vitest";
import {
  buildCommodityOutputSnapshot,
  computeCommodityOutputSharePercent,
  findCommodityOutputBasisChange,
} from "./corpCommoditySnapshot";
import {
  COMMODITY_BASE_PRICES,
  commodityMixWeight,
  dollarsToUnits,
} from "@/lib/constants/commodities";

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

  it("records measured plant production instead of the revenue nameplate", () => {
    const out = buildCommodityOutputSnapshot(
      [mkSector({ revenue: 100_000, producedUnits: 900, capacityUnits: 1_000 })],
      10,
      { plantsEnabled: true }
    );
    expect(out.steel).toBeCloseTo(
      900 *
        commodityMixWeight({ steel: 0.4, building_materials: 0.2 }, COMMODITY_BASE_PRICES, "steel"),
      1
    );
  });

  it("normalizes host-currency revenue to the anchor before deriving the nameplate", () => {
    const out = buildCommodityOutputSnapshot(
      [mkSector({ revenue: 36_655_000, revenueAnchor: 100_000 })],
      10
    );
    expect(out.steel).toBeCloseTo(dollarsToUnits(100_000 * 0.4, COMMODITY_BASE_PRICES.steel), 1);
  });

  it("records nothing for a mothballed plant", () => {
    const out = buildCommodityOutputSnapshot(
      [mkSector({ revenue: 100_000, producedUnits: 900, capacityUnits: 1_000, mothballed: true })],
      10,
      { plantsEnabled: true }
    );
    expect(out).toEqual({});
  });

  it("drops extraction supply for resources the operating state has no deposits of", () => {
    const out = buildCommodityOutputSnapshot(
      [mkSector({ sectorType: "extraction", stateId: "CA", revenue: 100_000 })],
      10,
      { stateResourcesByState: new Map([["CA", { iron: 500 }]]) }
    );
    expect(out.iron).toBeGreaterThan(0);
    expect(out.coal).toBeUndefined();
    expect(out.oil).toBeUndefined();
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

describe("findCommodityOutputBasisChange", () => {
  it("marks the historical switch from the revenue proxy to measured plant output", () => {
    expect(
      findCommodityOutputBasisChange([
        { turn: 346, createdAt: "2026-08-24T02:00:06.291Z" },
        { turn: 347, createdAt: "2026-08-24T03:00:05.857Z" },
        { turn: 348, createdAt: "2026-08-24T04:00:01.742Z" },
      ])
    ).toEqual({
      turn: 347,
      from: "revenue-proxy-v1",
      to: "plants-ledger-v1",
    });
  });

  it("does not invent a cutover for a later world or an ordinary output change", () => {
    expect(
      findCommodityOutputBasisChange([
        { turn: 346, createdAt: "2026-09-01T02:00:00.000Z" },
        { turn: 347, createdAt: "2026-09-01T03:00:00.000Z" },
      ])
    ).toBeNull();
  });

  it("prefers an explicitly persisted basis", () => {
    expect(
      findCommodityOutputBasisChange([
        { turn: 10, commodityOutputBasis: "revenue-proxy-v1" },
        { turn: 11, commodityOutputBasis: "plants-ledger-v1" },
      ])
    ).toEqual({ turn: 11, from: "revenue-proxy-v1", to: "plants-ledger-v1" });
  });
});
