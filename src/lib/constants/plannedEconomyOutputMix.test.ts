import { describe, it, expect } from "vitest";
import {
  applyPlannedEconomyOutputMix,
  PLANNED_ECONOMY_MEDIA_OUTPUT,
  getStrategy,
  plannedEconomyMediaSupplyFactor,
} from "./sectorStrategies";
import { COMMODITY_BASE_PRICES, type CommodityType } from "./commodities";

const mediaStandard = () => getStrategy("media", "standard").supply;

describe("applyPlannedEconomyOutputMix", () => {
  it("moves media's advertising output to state broadcasting in a planned economy", () => {
    const out = applyPlannedEconomyOutputMix("media", mediaStandard(), true);
    expect(out.advertising).toBeUndefined();
    expect(out[PLANNED_ECONOMY_MEDIA_OUTPUT]).toBeGreaterThan(0);
  });

  it("preserves capacity unit yield k, so RPU and facility sizing do not move", () => {
    // k = sum(rate / basePrice) is what the engine uses (capacityUnitYield ->
    // revenuePerCapacityUnit -> build cost and facility size). Conserving
    // sum(rate * basePrice) instead moves k by the price ratio and trips
    // facilityQuantum.test.ts.
    const before = mediaStandard();
    const after = applyPlannedEconomyOutputMix("media", before, true);
    const k = (mix: Partial<Record<CommodityType, number>>) =>
      Object.entries(mix).reduce(
        (sum, [c, r]) => sum + (r ?? 0) / COMMODITY_BASE_PRICES[c as CommodityType],
        0
      );
    expect(k(after)).toBeCloseTo(k(before), 12);
    // 0.5 advertising (base 150) becomes 2.0 state broadcasting (base 600).
    expect(after[PLANNED_ECONOMY_MEDIA_OUTPUT]).toBeCloseTo(
      (before.advertising ?? 0) * 4 + (before[PLANNED_ECONOMY_MEDIA_OUTPUT] ?? 0),
      10
    );
  });

  it("is a no-op in a market economy", () => {
    const mix = mediaStandard();
    expect(applyPlannedEconomyOutputMix("media", mix, false)).toBe(mix);
  });

  it("is a no-op for every non-media sector", () => {
    const agri = getStrategy("agriculture", "standard").supply;
    expect(applyPlannedEconomyOutputMix("agriculture", agri, true)).toBe(agri);
  });

  it("is a no-op for a media mix that produces no advertising", () => {
    const noAds: Partial<Record<CommodityType, number>> = { entertainment_services: 0.4 };
    expect(applyPlannedEconomyOutputMix("media", noAds, true)).toBe(noAds);
  });

  it("adds onto an existing state-broadcasting leg rather than overwriting it", () => {
    const mixed: Partial<Record<CommodityType, number>> = {
      advertising: 0.4,
      entertainment_services: 0.3,
    };
    const out = applyPlannedEconomyOutputMix("media", mixed, true);
    // 0.3 kept + 0.4 re-rated at 600/150 to hold k = 0.3 + 1.6.
    expect(out[PLANNED_ECONOMY_MEDIA_OUTPUT]).toBeCloseTo(1.9, 10);
    expect(out.advertising).toBeUndefined();
  });

  it("does not mutate the caller's mix", () => {
    const mix: Partial<Record<CommodityType, number>> = { advertising: 0.5 };
    applyPlannedEconomyOutputMix("media", mix, true);
    expect(mix.advertising).toBe(0.5);
  });
});

describe("plannedEconomyMediaSupplyFactor", () => {
  it("derates planned-economy media and nothing else", () => {
    expect(plannedEconomyMediaSupplyFactor("media", true)).toBe(0.25);
    expect(plannedEconomyMediaSupplyFactor("media", false)).toBe(1);
    expect(plannedEconomyMediaSupplyFactor("agriculture", true)).toBe(1);
    expect(plannedEconomyMediaSupplyFactor("entertainment", true)).toBe(1);
  });

  it("is revenue-neutral against the re-pointing price step", () => {
    // State broadcasting prices at 4x advertising, so a quarter of the units at
    // four times the price earns the same. Bloc media gains no free money from
    // the re-map and is not broken by the derate.
    const priceStep =
      COMMODITY_BASE_PRICES.entertainment_services / COMMODITY_BASE_PRICES.advertising;
    expect(priceStep * plannedEconomyMediaSupplyFactor("media", true)).toBeCloseTo(1, 12);
  });
});
