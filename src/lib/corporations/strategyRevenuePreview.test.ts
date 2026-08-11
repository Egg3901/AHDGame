import { describe, it, expect } from "vitest";
import { projectStrategyRevenuePerTurn, buildDepositCapacityRows } from "./strategyRevenuePreview";

describe("projectStrategyRevenuePerTurn", () => {
  const ratios = new Map<string, number>([
    ["oil", 2.0],
    ["coal", 0.5],
  ]);

  it("computes revenue × Σ(rate × priceRatio)", () => {
    const projected = projectStrategyRevenuePerTurn({
      revenueAnchor: 1_000_000,
      supply: { oil: 0.4, coal: 0.2 },
      priceRatioByCommodity: ratios,
    });
    // 1M × (0.4×2.0 + 0.2×0.5) = 1M × 0.9
    expect(projected).toBeCloseTo(900_000, 5);
  });

  it("defaults missing or non-positive price ratios to 1 (at base)", () => {
    const projected = projectStrategyRevenuePerTurn({
      revenueAnchor: 100,
      supply: { iron: 0.5 },
      priceRatioByCommodity: new Map([["iron", -3]]),
    });
    expect(projected).toBeCloseTo(50, 5);
  });

  it("applies capacity multipliers to extractable outputs only", () => {
    const projected = projectStrategyRevenuePerTurn({
      revenueAnchor: 1_000_000,
      supply: { oil: 0.4, energy: 0.2 } as Record<string, number>,
      priceRatioByCommodity: new Map(),
      capacityMultipliers: { oil: 0.25 },
    });
    // oil clamped to 25%: 0.4×0.25 + energy uncapped 0.2 = 0.3
    expect(projected).toBeCloseTo(300_000, 5);
  });

  it("treats missing multiplier entries as 1 when a map is provided", () => {
    const projected = projectStrategyRevenuePerTurn({
      revenueAnchor: 100,
      supply: { coal: 0.3 },
      priceRatioByCommodity: new Map(),
      capacityMultipliers: {},
    });
    expect(projected).toBeCloseTo(30, 5);
  });

  it("zeroes extractables when capacityMultipliers is null (cap doc without resources)", () => {
    const projected = projectStrategyRevenuePerTurn({
      revenueAnchor: 1_000_000,
      supply: { oil: 0.4, coal: 0.2 },
      priceRatioByCommodity: ratios,
      capacityMultipliers: null,
    });
    expect(projected).toBe(0);
  });

  it("ignores capacity entirely when capacityMultipliers is undefined (uncapped state)", () => {
    const projected = projectStrategyRevenuePerTurn({
      revenueAnchor: 1_000_000,
      supply: { oil: 0.4 },
      priceRatioByCommodity: ratios,
    });
    expect(projected).toBeCloseTo(800_000, 5);
  });

  it("skips zero/negative rates and returns 0 for non-positive revenue", () => {
    expect(
      projectStrategyRevenuePerTurn({
        revenueAnchor: 100,
        supply: { oil: 0 },
        priceRatioByCommodity: ratios,
      })
    ).toBe(0);
    expect(
      projectStrategyRevenuePerTurn({
        revenueAnchor: 0,
        supply: { oil: 0.5 },
        priceRatioByCommodity: ratios,
      })
    ).toBe(0);
  });
});

describe("buildDepositCapacityRows", () => {
  it("returns one row per resource with capacity, with desired and headroom", () => {
    const rows = buildDepositCapacityRows(
      { oil: 1000, coal: 0, iron: 200 },
      { oil: 400, iron: 350 }
    );
    expect(rows).toEqual([
      { resource: "oil", capacity: 1000, desired: 400, headroom: 600 },
      { resource: "iron", capacity: 200, desired: 350, headroom: -150 },
    ]);
  });

  it("treats missing desired as 0 and skips zero-capacity resources", () => {
    const rows = buildDepositCapacityRows({ timber: 50 }, {});
    expect(rows).toEqual([{ resource: "timber", capacity: 50, desired: 0, headroom: 50 }]);
  });
});
