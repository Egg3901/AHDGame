import { describe, it, expect } from "vitest";
import { NEUTRAL_STAT } from "@/lib/stats/statsConstants";
import {
  acumenGrowthCostMultiplier,
  getDominanceGrowthCostMultiplier,
} from "@/lib/constants/corporations";
import { TECH_GROWTH_REDUCTION_CAP, aggregateTechEffects } from "@/lib/constants/techTree/effects";
import {
  CAPACITY_ANCHOR_YEAR,
  HOST_BUILD_PRICE_INDEX_MAX,
  HOST_BUILD_PRICE_INDEX_MIN,
  computeBuildCost,
  hostBuildPriceIndex,
} from "./capacityEconomy";

/**
 * P3a pricing third: host-country price indexing, and the tech/acumen remap off
 * the (now vestigial) growth-cost line onto the build price.
 */

const BASE = {
  sectorType: "manufacturing" as const,
  units: 1_000,
  year: CAPACITY_ANCHOR_YEAR,
  eraUnitScale: 1,
};

describe("host build price index", () => {
  it("is neutral at a neutral cost of living, and when the metric is missing", () => {
    expect(hostBuildPriceIndex(100)).toBe(1);
    expect(hostBuildPriceIndex(null)).toBe(1);
    expect(hostBuildPriceIndex(undefined)).toBe(1);
    expect(hostBuildPriceIndex(Number.NaN)).toBe(1);
    expect(hostBuildPriceIndex(0)).toBe(1);
    expect(hostBuildPriceIndex(-50)).toBe(1);
  });

  it("prices expensive places up and cheap places down", () => {
    expect(hostBuildPriceIndex(130)).toBeCloseTo(1.3, 9);
    expect(hostBuildPriceIndex(80)).toBeCloseTo(0.8, 9);
  });

  it("clamps the tails so a cost-of-living swing cannot become a build exploit", () => {
    // costOfLiving's registry bounds are [40, 200] — a 5x spread, far too wide
    // for a proxy this rough.
    expect(hostBuildPriceIndex(40)).toBe(HOST_BUILD_PRICE_INDEX_MIN);
    expect(hostBuildPriceIndex(200)).toBe(HOST_BUILD_PRICE_INDEX_MAX);
  });

  it("is surfaced as a named factor on the cost breakdown", () => {
    const cost = computeBuildCost({ ...BASE, hostCostOfLivingIndex: 130 });
    expect(cost.hostPriceMultiplier).toBeCloseTo(1.3, 9);
    const neutral = computeBuildCost(BASE);
    expect(cost.totalAnchor).toBeCloseTo(neutral.totalAnchor * 1.3, 6);
  });
});

describe("host indexing does not open a currency carry trade", () => {
  /**
   * The failure mode this pins: build prices are charged in ₳ (anchor). If the
   * host index were a NOMINAL exchange rate, a corp could incorporate in a
   * weak-currency host, build capacity there for fewer real ₳, and sell into a
   * strong market — free capacity manufactured out of an FX quote. The chosen
   * index (`economic.costOfLiving`) is a pure 100-centered index, denominated in
   * nothing, so currency strength cannot enter the price at all.
   */
  it("two hosts with the same cost of living price identically, whatever their currency", () => {
    // Same index value is the ONLY input; there is no currency term to differ on.
    const weakCurrencyHost = computeBuildCost({ ...BASE, hostCostOfLivingIndex: 100 });
    const strongCurrencyHost = computeBuildCost({ ...BASE, hostCostOfLivingIndex: 100 });
    expect(weakCurrencyHost.totalAnchor).toBe(strongCurrencyHost.totalAnchor);
  });

  it("the whole spread between the cheapest and dearest host is bounded", () => {
    const cheapest = computeBuildCost({ ...BASE, hostCostOfLivingIndex: 5 });
    const dearest = computeBuildCost({ ...BASE, hostCostOfLivingIndex: 5_000 });
    const spread = dearest.totalAnchor / cheapest.totalAnchor;
    expect(spread).toBeCloseTo(HOST_BUILD_PRICE_INDEX_MAX / HOST_BUILD_PRICE_INDEX_MIN, 9);
    // Tolerance: siting must be a real decision, not a money printer. Under 3x.
    expect(spread).toBeLessThan(3);
  });

  it("no host is ever free or negative", () => {
    for (const col of [-1, 0, 1, 40, 100, 200, 1e9, Number.NaN, Number.POSITIVE_INFINITY]) {
      const cost = computeBuildCost({ ...BASE, hostCostOfLivingIndex: col });
      expect(cost.totalAnchor).toBeGreaterThan(0);
      expect(Number.isFinite(cost.totalAnchor)).toBe(true);
    }
  });
});

describe("tech / acumen remap onto the build price", () => {
  it("a sharp CEO pays less to build, by exactly the growth-path discount", () => {
    const neutral = computeBuildCost({ ...BASE, acumen: NEUTRAL_STAT });
    const sharp = computeBuildCost({ ...BASE, acumen: 10 });
    expect(neutral.acumenMultiplier).toBeCloseTo(1, 9);
    expect(sharp.acumenMultiplier).toBeCloseTo(acumenGrowthCostMultiplier(10), 9);
    expect(sharp.acumenMultiplier).toBeLessThan(1);
    // Both acumen legs bite: the flat discount AND the dampened rate term.
    const neutralRated = computeBuildCost({ ...BASE, acumen: NEUTRAL_STAT, primeRate: 5 });
    const sharpRated = computeBuildCost({ ...BASE, acumen: 10, primeRate: 5 });
    expect(sharpRated.rateMultiplier).toBeLessThan(neutralRated.rateMultiplier);
    expect(sharpRated.totalAnchor).toBeLessThan(neutralRated.totalAnchor);
  });

  it("a weak CEO pays more, and the discount stays clamped at the growth-path floor", () => {
    expect(computeBuildCost({ ...BASE, acumen: 1 }).acumenMultiplier).toBeGreaterThan(1);
    expect(computeBuildCost({ ...BASE, acumen: 1_000 }).acumenMultiplier).toBe(0.5);
  });

  it("tech growth-cost reduction becomes a build-price discount", () => {
    const agg = aggregateTechEffects([{ kind: "growthCostReduction", pct: 0.2 }]);
    const cost = computeBuildCost({ ...BASE, techGrowthCostMultiplier: agg.growthCostMultiplier });
    expect(cost.techMultiplier).toBeCloseTo(0.8, 9);
    expect(cost.totalAnchor).toBeCloseTo(computeBuildCost(BASE).totalAnchor * 0.8, 6);
  });

  it("keeps today's cap — a fully-researched corp cannot build for free", () => {
    const agg = aggregateTechEffects([
      { kind: "growthCostReduction", pct: 0.4 },
      { kind: "growthCostReduction", pct: 0.4 },
      { kind: "growthCostReduction", pct: 0.4 },
    ]);
    const cost = computeBuildCost({ ...BASE, techGrowthCostMultiplier: agg.growthCostMultiplier });
    expect(cost.techMultiplier).toBeCloseTo(1 - TECH_GROWTH_REDUCTION_CAP, 9);
    expect(cost.techMultiplier).toBeGreaterThan(0);
  });

  it("is neutral with the tech tree off, or on a malformed multiplier", () => {
    expect(computeBuildCost(BASE).techMultiplier).toBe(1);
    for (const bad of [0, -1, 2, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(computeBuildCost({ ...BASE, techGrowthCostMultiplier: bad }).techMultiplier).toBe(1);
    }
  });

  it("composes every factor multiplicatively, as the breakdown claims", () => {
    const cost = computeBuildCost({
      ...BASE,
      marketSharePercent: 80,
      primeRate: 4,
      acumen: 8,
      hostCostOfLivingIndex: 120,
      techGrowthCostMultiplier: 0.85,
      founding: true,
    });
    expect(cost.totalAnchor).toBeCloseTo(
      BASE.units *
        cost.unitPriceAnchor *
        cost.dominanceMultiplier *
        cost.rateMultiplier *
        cost.acumenMultiplier *
        cost.techMultiplier *
        cost.hostPriceMultiplier *
        cost.foundingMultiplier,
      6
    );
  });
});

describe("dominance is tolled at build time", () => {
  it("a dominant sector pays a build premium", () => {
    const small = computeBuildCost({ ...BASE, marketSharePercent: 10 });
    const dominant = computeBuildCost({ ...BASE, marketSharePercent: 90 });
    expect(small.dominanceMultiplier).toBe(getDominanceGrowthCostMultiplier(10));
    expect(dominant.dominanceMultiplier).toBeGreaterThan(small.dominanceMultiplier);
    expect(dominant.totalAnchor).toBeGreaterThan(small.totalAnchor);
  });

  it("prices the same as the legacy growth path's dominance multiplier", () => {
    for (const share of [0, 40, 55, 70, 100]) {
      expect(computeBuildCost({ ...BASE, marketSharePercent: share }).dominanceMultiplier).toBe(
        getDominanceGrowthCostMultiplier(share)
      );
    }
  });
});
