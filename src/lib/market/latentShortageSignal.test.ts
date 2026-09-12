import { describe, expect, it } from "vitest";
import {
  COMMODITY_BASE_PRICES,
  computeMarketPrice,
  getPriceSoftKnee,
} from "@/lib/constants/commodities";
import type { CommodityPrice } from "@/lib/db/types/commodityPrice";
import {
  latentAwareGlobalRatio,
  latentAwareNationalRatio,
  latentAwarePriceRatio,
  latentAwareStateRatio,
  latentDemandTopUp,
  latentTopUpForCountry,
  latentTopUpForState,
} from "./latentShortageSignal";

const COMMODITY = "energy" as const;

function priceDoc(overrides: Partial<CommodityPrice> = {}): CommodityPrice {
  return {
    commodity: COMMODITY,
    basePrice: COMMODITY_BASE_PRICES[COMMODITY],
    globalPrice: 100,
    globalSupply: 1_000,
    globalDemand: 1_500,
    statePrices: {},
    stateSupply: {},
    stateDemand: {},
    turn: 1,
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("latentDemandTopUp", () => {
  it("splits truncated units pro-rata by capped demand share", () => {
    expect(latentDemandTopUp(500, 1_000, 300)).toBe(150);
    expect(latentDemandTopUp(1_000, 1_000, 300)).toBe(300);
  });

  it("returns 0 when there is nothing to attribute", () => {
    expect(latentDemandTopUp(500, 1_000, 0)).toBe(0);
    expect(latentDemandTopUp(500, 1_000, undefined)).toBe(0);
    expect(latentDemandTopUp(500, 1_000, null)).toBe(0);
    expect(latentDemandTopUp(0, 1_000, 300)).toBe(0);
    expect(latentDemandTopUp(500, 0, 300)).toBe(0);
    expect(latentDemandTopUp(-5, 1_000, 300)).toBe(0);
  });
});

describe("latentAwarePriceRatio", () => {
  it("returns the stored ratio untouched when nothing was truncated", () => {
    expect(
      latentAwarePriceRatio({
        storedRatio: 1.1,
        commodity: COMMODITY,
        supply: 1_000,
        cappedDemand: 1_500,
        globalCappedDemand: 1_500,
        truncatedUnits: undefined,
      })
    ).toBe(1.1);
    expect(
      latentAwarePriceRatio({
        storedRatio: 1.1,
        commodity: COMMODITY,
        supply: 1_000,
        cappedDemand: 1_500,
        globalCappedDemand: 1_500,
        truncatedUnits: 0,
      })
    ).toBe(1.1);
  });

  it("lifts the signal through the same price curve the turn uses", () => {
    const supply = 1_000;
    const cappedDemand = 1_500;
    const stored = 1.1;
    const lifted = latentAwarePriceRatio({
      storedRatio: stored,
      commodity: COMMODITY,
      supply,
      cappedDemand,
      globalCappedDemand: cappedDemand,
      truncatedUnits: 2_000,
    });
    const expected =
      computeMarketPrice(
        COMMODITY_BASE_PRICES[COMMODITY],
        supply,
        cappedDemand + 2_000,
        getPriceSoftKnee(COMMODITY)
      ) / COMMODITY_BASE_PRICES[COMMODITY];
    expect(lifted).toBe(Math.max(stored, expected));
    expect(lifted).toBeGreaterThan(stored);
  });

  it("never weakens the stored signal and tolerates degenerate books", () => {
    const lifted = latentAwarePriceRatio({
      storedRatio: 2.5,
      commodity: COMMODITY,
      supply: 1_000,
      cappedDemand: 1_500,
      globalCappedDemand: 1_500,
      truncatedUnits: 10,
    });
    expect(lifted).toBe(2.5);
    // No supply to recompute against: stored survives.
    expect(
      latentAwarePriceRatio({
        storedRatio: 1.2,
        commodity: COMMODITY,
        supply: 0,
        cappedDemand: 100,
        globalCappedDemand: 1_500,
        truncatedUnits: 500,
      })
    ).toBe(1.2);
    // No stored ratio but real hidden demand: still a signal, not null.
    expect(
      latentAwarePriceRatio({
        storedRatio: null,
        commodity: COMMODITY,
        supply: 1_000,
        cappedDemand: 1_500,
        globalCappedDemand: 1_500,
        truncatedUnits: 500,
      })
    ).toBeGreaterThan(1);
  });
});

describe("doc-level latent ratios", () => {
  const doc = priceDoc({
    globalPrice: COMMODITY_BASE_PRICES[COMMODITY] * 1.1,
    globalSupply: 1_000,
    globalDemand: 1_500,
    demandTruncatedUnits: 2_000,
    nationalPrices: { US: COMMODITY_BASE_PRICES[COMMODITY] * 1.05 },
    nationalSupply: { US: 400 },
    nationalDemand: { US: 600 },
    statePrices: { NY: COMMODITY_BASE_PRICES[COMMODITY] * 0.9 },
    stateSupply: { NY: 100 },
    stateDemand: { NY: 90 },
  });

  it("lifts the global ratio by the full truncated amount", () => {
    expect(latentAwareGlobalRatio(doc)).toBeGreaterThan(1.1);
  });

  it("lifts the national ratio by the country's share, preserving a reachable override", () => {
    const lifted = latentAwareNationalRatio(doc, "US");
    expect(lifted).toBeGreaterThan(1.05);
    const reachableStored = 1.3;
    expect(latentAwareNationalRatio(doc, "US", reachableStored)).toBeGreaterThanOrEqual(
      reachableStored
    );
  });

  it("returns the stored ratio unchanged when nothing was truncated", () => {
    const lifted = latentAwareNationalRatio(priceDoc(), "US");
    expect(lifted).toBe(100 / COMMODITY_BASE_PRICES[COMMODITY]);
  });

  it("preserves relative starvation between states after the lift", () => {
    // NY is locally glutted (90/100) but the world is deeply short; the lift
    // raises NY yet the starved state still ranks far above it, so placement
    // keeps routing to the state that is actually starved.
    const ny = latentAwareStateRatio(doc, "NY");
    const starved = latentAwareStateRatio(
      priceDoc({
        globalSupply: 1_000,
        globalDemand: 1_500,
        demandTruncatedUnits: 2_000,
        statePrices: { TX: COMMODITY_BASE_PRICES[COMMODITY] * 1.2 },
        stateSupply: { TX: 100 },
        stateDemand: { TX: 500 },
      }),
      "TX"
    );
    expect(ny).toBeGreaterThan(0.9);
    expect(starved).toBeGreaterThan(ny!);
  });

  it("attributes advisor top-ups by scope share", () => {
    expect(latentTopUpForCountry(doc, "US")).toBe(2_000 * (600 / 1_500));
    expect(latentTopUpForState(doc, "NY")).toBe(2_000 * (90 / 1_500));
    expect(latentTopUpForCountry(priceDoc(), "US")).toBe(0);
  });
});
