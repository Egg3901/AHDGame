import { describe, it, expect } from "vitest";
import {
  applyPlannedEconomyOutputMix,
  PLANNED_ECONOMY_MEDIA_OUTPUT,
  getStrategy,
} from "./sectorStrategies";
import { COMMODITY_BASE_PRICES, type CommodityType } from "./commodities";

const mediaStandard = () => getStrategy("media", "standard").supply;

describe("applyPlannedEconomyOutputMix", () => {
  it("moves media's advertising output to state broadcasting in a planned economy", () => {
    const out = applyPlannedEconomyOutputMix("media", mediaStandard(), true);
    expect(out.advertising).toBeUndefined();
    expect(out[PLANNED_ECONOMY_MEDIA_OUTPUT]).toBeGreaterThan(0);
  });

  it("conserves VALUE, not the rate — bloc media must not gain output by moving", () => {
    // Rates are per unit of revenue and the two commodities are priced 150 vs
    // 600, so carrying the rate across unchanged would hand bloc media 4x the
    // output value it had. Capacity is re-denominated, never inflated.
    const before = mediaStandard().advertising ?? 0;
    const out = applyPlannedEconomyOutputMix("media", mediaStandard(), true);
    const after = out[PLANNED_ECONOMY_MEDIA_OUTPUT] ?? 0;
    expect(after * COMMODITY_BASE_PRICES.entertainment_services).toBeCloseTo(
      before * COMMODITY_BASE_PRICES.advertising,
      8
    );
    expect(after).toBeCloseTo(before / 4, 10);
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
    // 0.3 kept + 0.4 re-denominated at the 150/600 value ratio = 0.3 + 0.1.
    expect(out[PLANNED_ECONOMY_MEDIA_OUTPUT]).toBeCloseTo(0.4, 10);
    expect(out.advertising).toBeUndefined();
  });

  it("does not mutate the caller's mix", () => {
    const mix: Partial<Record<CommodityType, number>> = { advertising: 0.5 };
    applyPlannedEconomyOutputMix("media", mix, true);
    expect(mix.advertising).toBe(0.5);
  });
});
