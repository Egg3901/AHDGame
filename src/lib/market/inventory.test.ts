import { describe, it, expect } from "vitest";
import {
  advanceStock,
  daysOfCover,
  EXCESS_STOCK_SPOILAGE_RATE,
  isStorable,
  STOCK_COVER_CAP_TURNS,
} from "./inventory";

describe("advanceStock", () => {
  it("accumulates net surplus into stock", () => {
    const r = advanceStock({
      commodity: "steel",
      prevStock: 1000,
      supplyUnits: 500,
      demandUnits: 300,
    });
    // 1000 + 200 = 1200, minus 0.2% carry loss
    expect(r.stock).toBeCloseTo(1200 * 0.998, 2);
    expect(r.spoiledUnits).toBeCloseTo(1200 * 0.002, 2);
  });

  it("draws stock down under deficit and floors at zero", () => {
    const r = advanceStock({ commodity: "iron", prevStock: 100, supplyUnits: 0, demandUnits: 500 });
    expect(r.stock).toBe(0);
    expect(r.spoiledUnits).toBe(0);
  });

  it("never accumulates stock for non-storable commodities", () => {
    const r = advanceStock({
      commodity: "healthcare_services",
      prevStock: 999,
      supplyUnits: 1000,
      demandUnits: 1,
    });
    expect(r.stock).toBe(0);
  });

  it("spoils food faster than steel", () => {
    const food = advanceStock({
      commodity: "food",
      prevStock: 0,
      supplyUnits: 1000,
      demandUnits: 0,
    });
    const steel = advanceStock({
      commodity: "steel",
      prevStock: 0,
      supplyUnits: 1000,
      demandUnits: 0,
    });
    expect(food.spoiledUnits).toBeGreaterThan(steel.spoiledUnits);
    expect(food.stock).toBeCloseTo(960, 2);
  });

  it("treats garbage prevStock as zero", () => {
    const r = advanceStock({ commodity: "coal", prevStock: NaN, supplyUnits: 100, demandUnits: 0 });
    expect(r.stock).toBeCloseTo(99.9, 1);
  });
});

describe("advanceStock cover cap (stockCoverCapEnabled)", () => {
  it("is inert when the flag is off, even at steel's overhang", () => {
    const base = {
      commodity: "steel" as const,
      prevStock: 1.22e9,
      supplyUnits: 0,
      demandUnits: 950_000,
    };
    const off = advanceStock(base);
    const offExplicit = advanceStock({ ...base, coverCapEnabled: false });
    expect(offExplicit).toEqual(off);
    expect(off.excessSpoiledUnits).toBe(0);
    // Base carry only: (1.22e9 − 950k) × 0.2%
    expect(off.spoiledUnits).toBeCloseTo((1.22e9 - 950_000) * 0.002, 0);
  });

  it("spoils 2% of the above-cap excess only, on top of base carry", () => {
    const demand = 950_000;
    const r = advanceStock({
      commodity: "steel",
      prevStock: 1.22e9,
      supplyUnits: 0,
      demandUnits: demand,
      coverCapEnabled: true,
    });
    const afterFlow = 1.22e9 - demand;
    const afterBase = afterFlow * (1 - 0.002);
    const excess = afterBase - STOCK_COVER_CAP_TURNS * demand;
    const expectedExtra = excess * EXCESS_STOCK_SPOILAGE_RATE;
    expect(r.excessSpoiledUnits).toBeCloseTo(expectedExtra, 0);
    expect(r.spoiledUnits).toBeCloseTo(afterFlow * 0.002 + expectedExtra, 0);
    expect(r.stock).toBeCloseTo(afterBase - expectedExtra, 0);
  });

  it("takes nothing extra at or below the cap boundary", () => {
    const demand = 100;
    // Choose prevStock so post-base-spoilage stock lands exactly on the cap.
    const capUnits = STOCK_COVER_CAP_TURNS * demand;
    const prevStock = capUnits / (1 - 0.002) + demand;
    const r = advanceStock({
      commodity: "steel",
      prevStock,
      supplyUnits: 0,
      demandUnits: demand,
      coverCapEnabled: true,
    });
    expect(r.excessSpoiledUnits).toBe(0);
    expect(r.stock).toBeCloseTo(capUnits, 1);
  });

  it("skips excess spoilage entirely when demand is zero", () => {
    const on = advanceStock({
      commodity: "steel",
      prevStock: 1e9,
      supplyUnits: 0,
      demandUnits: 0,
      coverCapEnabled: true,
    });
    const off = advanceStock({
      commodity: "steel",
      prevStock: 1e9,
      supplyUnits: 0,
      demandUnits: 0,
    });
    expect(on.excessSpoiledUnits).toBe(0);
    expect(on.stock).toBe(off.stock);
    expect(on.spoiledUnits).toBe(off.spoiledUnits);
  });
});

describe("daysOfCover", () => {
  it("is stock over per-turn demand for storables", () => {
    expect(daysOfCover("steel", 3000, 100)).toBe(30);
  });
  it("is null for non-storables and zero demand", () => {
    expect(daysOfCover("energy", 3000, 100)).toBeNull();
    expect(daysOfCover("steel", 3000, 0)).toBeNull();
  });
});

describe("isStorable", () => {
  it("classifies services non-storable and bulk goods storable", () => {
    expect(isStorable("entertainment_services")).toBe(false);
    expect(isStorable("rare_earth")).toBe(true);
    expect(isStorable("software")).toBe(true);
  });
});

describe("advanceStock — plants physical flow (P3b)", () => {
  it("books unsold production into stock instead of losing it", () => {
    // A two-sector world: plants made 900 units between them, sold 600, and
    // buyers wanted 600. The 300 unsold units must land in the pile.
    const r = advanceStock({
      commodity: "steel",
      prevStock: 0,
      supplyUnits: 900,
      demandUnits: 600,
      producedUnits: 900,
      soldUnits: 600,
    });
    // 0 + (900 − 600) unsold − 0 unmet = 300, minus steel's 0.2% carry loss.
    expect(r.stock).toBeCloseTo(300 * 0.998, 2);
    expect(r.spoiledUnits).toBeCloseTo(300 * 0.002, 2);
  });

  it("draws stock down for demand no producer met", () => {
    // Produced 400, all of it sold, but buyers wanted 700 — the missing 300
    // comes off the pile.
    const r = advanceStock({
      commodity: "steel",
      prevStock: 1000,
      supplyUnits: 400,
      demandUnits: 700,
      producedUnits: 400,
      soldUnits: 400,
    });
    expect(r.stock).toBeCloseTo(700 * 0.998, 2);
  });

  it("matches the legacy supply−demand flow when produced equals ledger supply", () => {
    for (const [supply, demand, sold] of [
      [900, 600, 600],
      [400, 700, 400],
      [500, 500, 500],
      [800, 300, 300],
    ]) {
      const legacy = advanceStock({
        commodity: "iron",
        prevStock: 5000,
        supplyUnits: supply,
        demandUnits: demand,
      });
      const physical = advanceStock({
        commodity: "iron",
        prevStock: 5000,
        supplyUnits: supply,
        demandUnits: demand,
        producedUnits: supply,
        soldUnits: sold,
      });
      expect(physical.stock).toBeCloseTo(legacy.stock, 2);
    }
  });

  it("is a no-op when only one of the two plants figures is supplied", () => {
    const legacy = advanceStock({
      commodity: "steel",
      prevStock: 100,
      supplyUnits: 50,
      demandUnits: 20,
    });
    const partial = advanceStock({
      commodity: "steel",
      prevStock: 100,
      supplyUnits: 50,
      demandUnits: 20,
      producedUnits: 50,
    });
    expect(partial.stock).toBeCloseTo(legacy.stock, 6);
  });
});
