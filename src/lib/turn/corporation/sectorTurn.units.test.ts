import { describe, it, expect } from "vitest";
import type { CommodityType } from "@/lib/constants/commodities";
import { impliedOutputUnits } from "@/lib/market/capital";
import { computeSectorOutputUnits } from "./sectorTurn";

const base = { iron: 120, coal: 150 } as Record<CommodityType, number>;

// Synthetic sector: 24,000 ₳/day nameplate revenue on a 0.5 iron + 0.25 coal
// output mix ⇒ 24000×0.5/120 + 24000×0.25/150 = 100 + 40 = 140 units/day.
const NAMEPLATE_REVENUE = 24_000;
const SUPPLY = { iron: 0.5, coal: 0.25 };
const NAMEPLATE_UNITS = 140;

describe("computeSectorOutputUnits", () => {
  it("produces nameplate units times the production legs", () => {
    // Production legs: policy 1.1 × nationalization 0.9 × haircut 0.8 ×
    // throughput 0.5 × capital 1 × strike 1 = 0.396.
    const productionFactor = 1.1 * 0.9 * 0.8 * 0.5;
    const { producedUnits, soldUnits } = computeSectorOutputUnits({
      nameplateUnits: impliedOutputUnits(NAMEPLATE_REVENUE, SUPPLY, base, 1),
      productionFactor,
      soldFraction: null,
    });
    expect(producedUnits).toBeCloseTo(NAMEPLATE_UNITS * 0.396, 10);
    expect(producedUnits).toBeCloseTo(55.44, 10);
    // No clearing pre-pass ⇒ sold == produced.
    expect(soldUnits).toBe(producedUnits);
  });

  it("scales sold units by soldFraction when clearing ran", () => {
    const { producedUnits, soldUnits } = computeSectorOutputUnits({
      nameplateUnits: NAMEPLATE_UNITS,
      productionFactor: 0.5,
      soldFraction: 0.6,
    });
    expect(producedUnits).toBe(70);
    expect(soldUnits).toBeCloseTo(42, 10);
  });

  it("floors garbage inputs at zero", () => {
    expect(
      computeSectorOutputUnits({ nameplateUnits: NaN, productionFactor: 1, soldFraction: null })
        .producedUnits
    ).toBe(0);
    expect(
      computeSectorOutputUnits({ nameplateUnits: 100, productionFactor: -1, soldFraction: null })
        .producedUnits
    ).toBe(0);
    expect(
      computeSectorOutputUnits({ nameplateUnits: 100, productionFactor: 1, soldFraction: -0.5 })
        .soldUnits
    ).toBe(0);
  });
});

describe("units chain reconciles with the dollar chain", () => {
  it("producedUnits × mixPrice × sales legs == realizedRevenue", () => {
    const productionFactor = 1.1 * 0.9 * 0.8 * 0.5;
    // Sales-side legs: clearing/price leg and the embargo export strip.
    const clearingRevenueLeg = 0.85;
    const embargoRevenueFactor = 0.9;

    // Dollar chain exactly as sectorTurn builds it (daily basis).
    const realizedRevenue =
      NAMEPLATE_REVENUE * productionFactor * clearingRevenueLeg * embargoRevenueFactor;

    const nameplateUnits = impliedOutputUnits(NAMEPLATE_REVENUE, SUPPLY, base, 1);
    const { producedUnits } = computeSectorOutputUnits({
      nameplateUnits,
      productionFactor,
      soldFraction: 0.6,
    });
    // mixPrice = nameplate revenue per nameplate output unit.
    const mixPrice = NAMEPLATE_REVENUE / nameplateUnits;

    expect(producedUnits * mixPrice * clearingRevenueLeg * embargoRevenueFactor).toBeCloseTo(
      realizedRevenue,
      8
    );
  });
});
