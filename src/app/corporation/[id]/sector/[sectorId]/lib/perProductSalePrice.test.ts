import { describe, expect, it } from "vitest";
import { perProductSalePrices } from "./perProductSalePrice";

describe("perProductSalePrices", () => {
  it("splits a blended average into each output's own price (ticket 1507)", () => {
    // 100 units of ordnance at 15,000 and 200 units of chemicals at 500 sold:
    // revenue 1,600,000, blended average 5,333 a unit.
    const revenue = 100 * 15_000 + 200 * 500;
    const prices = perProductSalePrices({
      supplies: [
        { commodity: "ordnance", units: 100, soldFraction: 1, revenueShare: 1_500_000 / revenue },
        { commodity: "chemicals", units: 200, soldFraction: 1, revenueShare: 100_000 / revenue },
      ],
      revenue,
      soldUnits: 300,
    });
    expect(prices.get("ordnance")).toBeCloseTo(15_000, 6);
    expect(prices.get("chemicals")).toBeCloseTo(500, 6);
  });

  it("adds back up to revenue on the sector's sold-unit basis", () => {
    const supplies = [
      { commodity: "oil", units: 58, soldFraction: 0.5, revenueShare: 0.4 },
      { commodity: "natural_gas", units: 32, soldFraction: 1, revenueShare: 0.6 },
    ];
    // Row units are nameplate; the sector booked 120 sold units.
    const prices = perProductSalePrices({ supplies, revenue: 9_000, soldUnits: 120 });
    const weightSum = 58 * 0.5 + 32 * 1;
    const total = supplies.reduce(
      (sum, f) => sum + prices.get(f.commodity)! * ((f.units * f.soldFraction) / weightSum) * 120,
      0
    );
    expect(total).toBeCloseTo(9_000, 6);
  });

  it("shows nothing for a one-output sector or a sector with no recorded split", () => {
    expect(
      perProductSalePrices({
        supplies: [{ commodity: "steel", units: 10, soldFraction: 1, revenueShare: 1 }],
        revenue: 100,
        soldUnits: 10,
      }).size
    ).toBe(0);
    expect(
      perProductSalePrices({
        supplies: [
          { commodity: "oil", units: 10, soldFraction: 1, revenueShare: 0.5 },
          { commodity: "natural_gas", units: 10, soldFraction: 1 },
        ],
        revenue: 100,
        soldUnits: 20,
      }).size
    ).toBe(0);
  });

  it("skips an output that sold nothing and guards empty revenue", () => {
    const prices = perProductSalePrices({
      supplies: [
        { commodity: "oil", units: 10, soldFraction: 0, revenueShare: 0 },
        { commodity: "natural_gas", units: 10, soldFraction: 1, revenueShare: 1 },
      ],
      revenue: 500,
      soldUnits: 10,
    });
    expect(prices.has("oil")).toBe(false);
    expect(prices.get("natural_gas")).toBeCloseTo(50, 6);
    expect(
      perProductSalePrices({
        supplies: [
          { commodity: "oil", units: 10, soldFraction: 1, revenueShare: 0.5 },
          { commodity: "natural_gas", units: 10, soldFraction: 1, revenueShare: 0.5 },
        ],
        revenue: 0,
        soldUnits: 20,
      }).size
    ).toBe(0);
  });
});
