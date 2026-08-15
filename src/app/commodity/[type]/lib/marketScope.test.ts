import { describe, expect, it } from "vitest";
import type { CommodityDetail } from "../types";
import { buildCommodityMarketScope } from "./marketScope";

function makeCommodityDetail(overrides: Partial<CommodityDetail> = {}): CommodityDetail {
  return {
    commodity: "rare_earth",
    label: "Rare Earth Minerals",
    icon: "RE",
    colors: "text-primary",
    unit: "kg",
    basePrice: 100,
    globalPrice: 130,
    globalSupply: 1000,
    globalDemand: 1200,
    priceChange: 30,
    annualPriceChange: 12,
    statePrices: { CA: 135, TX: 128, BRE: 92, BAY: 96 },
    stateSupply: { CA: 300, TX: 250, BRE: 90, BAY: 110 },
    stateDemand: { CA: 200, TX: 260, BRE: 150, BAY: 140 },
    nationalPrices: { US: 132, DE: 95 },
    nationalSupply: { US: 550, DE: 200 },
    nationalDemand: { US: 460, DE: 290 },
    stateCountryMap: { CA: "US", TX: "US", BRE: "DE", BAY: "DE" },
    capacityByState: { CA: 500, TX: 300, BRE: 40, BAY: 60 },
    totalCapacity: 900,
    turn: 1,
    history: [],
    suppliers: [],
    consumers: [],
    topProducers: [
      { corpId: "global-us", name: "US Miner", units: 400 },
      { corpId: "global-de", name: "DE Miner", units: 150 },
    ],
    topConsumers: [
      { corpId: "global-us-consumer", name: "US Factory", units: 320 },
      { corpId: "global-de-consumer", name: "DE Factory", units: 140 },
    ],
    topProducersByCountry: {
      US: [{ corpId: "us-1", name: "US Miner", units: 400 }],
      DE: [{ corpId: "de-1", name: "DE Miner", units: 150 }],
    },
    topConsumersByCountry: {
      US: [{ corpId: "us-c1", name: "US Factory", units: 320 }],
      DE: [{ corpId: "de-c1", name: "DE Factory", units: 140 }],
    },
    demandDriver: null,
    syntheticDemandSources: [
      {
        name: "Base Economic Demand",
        type: "system",
        units: 50,
        description: "baseline",
      },
    ],
    ...overrides,
  };
}

describe("buildCommodityMarketScope", () => {
  it("returns the unfiltered global market when no country is selected", () => {
    const data = makeCommodityDetail();

    const scope = buildCommodityMarketScope(data, null);

    expect(scope.marketLabel).toBe("Global Market");
    expect(scope.marketPrice).toBe(130);
    expect(scope.supply).toBe(1000);
    expect(scope.demand).toBe(1200);
    expect(scope.stateCountryMap).toEqual({ CA: "US", TX: "US", BRE: "DE", BAY: "DE" });
    expect(scope.topProducers).toHaveLength(2);
    expect(scope.syntheticDemandSources).toHaveLength(1);
    expect(scope.totalCapacity).toBe(900);
  });

  it("filters the market view to the selected country", () => {
    const data = makeCommodityDetail();

    const scope = buildCommodityMarketScope(data, "DE");

    expect(scope.marketLabel).toBe("DAX Market");
    expect(scope.marketCaption).toBe("Filtered to Germany.");
    expect(scope.marketPrice).toBe(95);
    expect(scope.priceChange).toBe(-5);
    expect(scope.supply).toBe(200);
    expect(scope.demand).toBe(290);
    expect(scope.balance).toBe(-90);
    expect(scope.regionCount).toBe(2);
    expect(scope.stateCountryMap).toEqual({ BRE: "DE", BAY: "DE" });
    expect(scope.stateSupply).toEqual({ BRE: 90, BAY: 110 });
    expect(scope.stateDemand).toEqual({ BRE: 150, BAY: 140 });
    expect(scope.statePrices).toEqual({ BRE: 92, BAY: 96 });
    expect(scope.capacityByState).toEqual({ BRE: 40, BAY: 60 });
    expect(scope.totalCapacity).toBe(100);
    expect(scope.topProducers).toEqual([{ corpId: "de-1", name: "DE Miner", units: 150 }]);
    expect(scope.topConsumers).toEqual([{ corpId: "de-c1", name: "DE Factory", units: 140 }]);
    expect(scope.syntheticDemandSources).toEqual([]);
  });

  it("passing a null activeState keeps prior Global behavior unchanged", () => {
    const data = makeCommodityDetail();

    const scope = buildCommodityMarketScope(data, null, null);

    expect(scope.activeState).toBeNull();
    expect(scope.marketLabel).toBe("Global Market");
    expect(scope.marketPrice).toBe(130);
  });

  it("passing a null activeState keeps prior Country behavior unchanged", () => {
    const data = makeCommodityDetail();

    const scope = buildCommodityMarketScope(data, "DE", null);

    expect(scope.activeState).toBeNull();
    expect(scope.marketLabel).toBe("DAX Market");
    expect(scope.marketPrice).toBe(95);
  });

  it("resolves a state scope from the per-state maps", () => {
    const data = makeCommodityDetail();

    const scope = buildCommodityMarketScope(data, "DE", "BRE");

    expect(scope.activeCountry).toBe("DE");
    expect(scope.activeState).toBe("BRE");
    expect(scope.marketLabel).toBe("Bremen Market");
    expect(scope.marketCaption).toBe("Filtered to Bremen, Germany.");
    expect(scope.marketPrice).toBe(92);
    expect(scope.priceChange).toBe(-8);
    expect(scope.supply).toBe(90);
    expect(scope.demand).toBe(150);
    expect(scope.balance).toBe(-60);
    expect(scope.regionCount).toBe(1);
    expect(scope.stateSupply).toEqual({ BRE: 90 });
    expect(scope.stateDemand).toEqual({ BRE: 150 });
    expect(scope.statePrices).toEqual({ BRE: 92 });
    expect(scope.stateCountryMap).toEqual({ BRE: "DE" });
    expect(scope.capacityByState).toEqual({ BRE: 40 });
    expect(scope.totalCapacity).toBe(40);
    expect(scope.topProducers).toEqual([{ corpId: "de-1", name: "DE Miner", units: 150 }]);
    expect(scope.topConsumers).toEqual([{ corpId: "de-c1", name: "DE Factory", units: 140 }]);
    expect(scope.syntheticDemandSources).toEqual([]);
  });

  it("falls back safely when the selected state has no per-state data", () => {
    const data = makeCommodityDetail();

    const scope = buildCommodityMarketScope(data, "US", "GHOST");

    expect(scope.activeState).toBe("GHOST");
    expect(scope.marketPrice).toBe(data.basePrice);
    expect(scope.priceChange).toBe(0);
    expect(scope.supply).toBe(0);
    expect(scope.demand).toBe(0);
    expect(scope.balance).toBe(0);
    expect(scope.totalCapacity).toBeUndefined();
    expect(scope.capacityByState).toBeUndefined();
  });

  it("does not crash when a state maps to a country code missing from COUNTRY_CONFIGS", () => {
    // Ticket #1101: a US player hit a client crash on the commodity page.
    // stateCountryMap is server data and can point a state at a country id
    // the client's COUNTRY_CONFIGS no longer has (removed/renamed country,
    // stale seed data). Trusting it as a CountryId threw
    // "Cannot read properties of undefined (reading 'name')" at
    // COUNTRY_CONFIGS[stateCountry].name.
    const data = makeCommodityDetail({
      stateCountryMap: { CA: "US", TX: "US", BRE: "DE", BAY: "DE", ZZ: "STALE_COUNTRY" },
    });

    expect(() => buildCommodityMarketScope(data, "US", "ZZ")).not.toThrow();

    const scope = buildCommodityMarketScope(data, "US", "ZZ");
    expect(scope.activeCountry).toBe("US");
    expect(scope.marketCaption).not.toContain("undefined");
  });

  it("does not crash in a state view when the fallback active country is also stale", () => {
    // Ticket #1101 follow-up: #234 guarded the country branch but left the state
    // branch's `COUNTRY_CONFIGS[stateCountry].name` unguarded. When the state's
    // mapping is stale AND activeCountry is itself stale, stateCountry falls back
    // to the stale activeCountry and the caption lookup threw "reading 'name'".
    const data = makeCommodityDetail({
      stateCountryMap: { ZZ: "STALE_COUNTRY" },
    });

    expect(() =>
      buildCommodityMarketScope(data, "STALE_COUNTRY" as unknown as never, "ZZ")
    ).not.toThrow();

    const scope = buildCommodityMarketScope(data, "STALE_COUNTRY" as unknown as never, "ZZ");
    expect(scope.marketCaption).not.toContain("undefined");
  });

  it("does not crash when activeCountry itself is missing from COUNTRY_CONFIGS", () => {
    const data = makeCommodityDetail();

    expect(() =>
      buildCommodityMarketScope(data, "STALE_COUNTRY" as unknown as never)
    ).not.toThrow();

    const scope = buildCommodityMarketScope(data, "STALE_COUNTRY" as unknown as never);
    expect(scope.marketLabel).toBe("STALE_COUNTRY Market");
    expect(scope.marketCaption).toBe("Filtered to STALE_COUNTRY.");
  });

  it("names a command economy's commodity market after the country, not its state register", () => {
    // RU carries exchangeName "GOSPLAN" so its state enterprises have a listing
    // venue, but a planning committee does not set commodity prices — the label
    // must stay "Russia Market". Guards the moment `exchangeName` stopped being
    // a reliable proxy for "this country runs a market".
    const data = makeCommodityDetail();

    const scope = buildCommodityMarketScope(data, "RU", null);

    expect(scope.marketLabel).toBe("Russia Market");
    expect(scope.marketLabel).not.toContain("GOSPLAN");
  });
});
