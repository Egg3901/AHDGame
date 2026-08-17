import { describe, it, expect } from "vitest";
import type { CommodityType } from "@/lib/constants/commodities";
import { computeInputsCost } from "./physicalPnl";

const basePrices: Record<CommodityType, number> = {
  coal: 100,
} as Record<CommodityType, number>;

function baseArgs() {
  return {
    nominalDailyRevenue: 1000,
    rates: { coal: 0.2 } as Partial<Record<CommodityType, number>>,
    basePrices,
    priceRatios: new Map<CommodityType, number>(),
    utilization: 1,
    inputMultiplier: 1,
    turnsPerDay: 4,
  };
}

describe("computeInputsCost — money wiring statePremiums", () => {
  it("absent statePremiums leaves output unchanged", () => {
    const withoutArg = computeInputsCost(baseArgs());
    const { statePremiums: _unused, ...rest } = { ...baseArgs(), statePremiums: undefined };
    const explicitlyUndefined = computeInputsCost(rest);
    expect(explicitlyUndefined).toEqual(withoutArg);
    expect(withoutArg.lines).toHaveLength(1);
    // units = (1000 * 0.2 / 100 / 4) * 1 * 1 = 0.5; unitPrice = 100 (ratio absent -> 1); cost = 50.
    expect(withoutArg.lines[0].units).toBeCloseTo(0.5);
    expect(withoutArg.lines[0].unitPrice).toBeCloseTo(100);
    expect(withoutArg.lines[0].cost).toBeCloseTo(50);
    expect(withoutArg.total).toBeCloseTo(50);
  });

  it("empty statePremiums map leaves output unchanged", () => {
    const base = computeInputsCost(baseArgs());
    const withEmpty = computeInputsCost({ ...baseArgs(), statePremiums: new Map() });
    expect(withEmpty).toEqual(base);
  });

  it("a premium adds premium * units to the line cost", () => {
    const premium = 10;
    const withPremium = computeInputsCost({
      ...baseArgs(),
      statePremiums: new Map<CommodityType, number>([["coal", premium]]),
    });
    // units unchanged at 0.5; unitPrice = 100 + 10 = 110; cost = 55.
    expect(withPremium.lines[0].units).toBeCloseTo(0.5);
    expect(withPremium.lines[0].unitPrice).toBeCloseTo(110);
    expect(withPremium.lines[0].cost).toBeCloseTo(55);
    expect(withPremium.total).toBeCloseTo(55);
    // Delta over the no-premium case is exactly premium * units.
    const base = computeInputsCost(baseArgs());
    expect(withPremium.total - base.total).toBeCloseTo(premium * 0.5);
  });

  it("ignores a premium for a commodity not in rates", () => {
    const withUnrelatedPremium = computeInputsCost({
      ...baseArgs(),
      statePremiums: new Map<CommodityType, number>([["oil" as CommodityType, 99]]),
    });
    const base = computeInputsCost(baseArgs());
    expect(withUnrelatedPremium).toEqual(base);
  });
});

describe("computeInputsCost — buy-sell realization symmetry", () => {
  it("prices a shortage input through priceRealizationFactor, not the raw ratio", () => {
    // ratio 2.75 (the live freight shortage that helped sink corp 445) must
    // bill at the same clamp(sqrt(ratio), 0.7, 1.5) the revenue side realizes
    // at — i.e. the 1.5 cap — never the raw 2.75.
    const shocked = computeInputsCost({
      ...baseArgs(),
      priceRatios: new Map<CommodityType, number>([["coal", 2.75]]),
    });
    expect(shocked.lines[0].unitPrice).toBeCloseTo(100 * 1.5);
    expect(shocked.total).toBeCloseTo(computeInputsCost(baseArgs()).total * 1.5);
  });

  it("floors a deep-glut input at the same 0.7 the revenue side floors at", () => {
    const glutted = computeInputsCost({
      ...baseArgs(),
      priceRatios: new Map<CommodityType, number>([["coal", 0.2]]),
    });
    expect(glutted.lines[0].unitPrice).toBeCloseTo(100 * 0.7);
  });

  it("dampens an in-band ratio by the square root", () => {
    const shocked = computeInputsCost({
      ...baseArgs(),
      priceRatios: new Map<CommodityType, number>([["coal", 1.44]]),
    });
    expect(shocked.lines[0].unitPrice).toBeCloseTo(100 * 1.2);
  });
});
