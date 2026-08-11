import { describe, it, expect } from "vitest";
import type { CommodityType } from "@/lib/constants/commodities";
import { buildCommodityFlowDocs } from "./flowLedger";

type Balance = { supply: number; demand: number };

function args(overrides: Partial<Parameters<typeof buildCommodityFlowDocs>[0]> = {}) {
  return {
    global: new Map<CommodityType, Balance>(),
    byCountry: new Map<string, Map<CommodityType, Balance>>(),
    globalPriceByCommodity: new Map<CommodityType, number>(),
    nationalPricesByCommodity: new Map<CommodityType, Record<string, number>>(),
    turn: 810,
    now: new Date("2026-07-03T00:00:00Z"),
    ...overrides,
  };
}

describe("buildCommodityFlowDocs", () => {
  it("returns no docs when the global balance map is empty", () => {
    expect(buildCommodityFlowDocs(args())).toHaveLength(0);
  });

  it("records shortage flows: cleared = supply, unmet = demand − supply", () => {
    const docs = buildCommodityFlowDocs(
      args({
        global: new Map([["rare_earth", { supply: 4504, demand: 24296 }]]),
        globalPriceByCommodity: new Map([["rare_earth", 12426.5]]),
      })
    );
    expect(docs).toHaveLength(1);
    const d = docs[0];
    expect(d.commodity).toBe("rare_earth");
    expect(d.turn).toBe(810);
    expect(d.clearedUnits).toBe(4504);
    expect(d.unmetDemandUnits).toBe(19792);
    expect(d.surplusUnits).toBe(0);
    expect(d.price).toBe(12426.5);
  });

  it("records glut flows: cleared = demand, surplus = supply − demand", () => {
    const docs = buildCommodityFlowDocs(
      args({ global: new Map([["entertainment_services", { supply: 168677, demand: 66265 }]]) })
    );
    const d = docs[0];
    expect(d.clearedUnits).toBe(66265);
    expect(d.surplusUnits).toBe(102412);
    expect(d.unmetDemandUnits).toBe(0);
  });

  it("breaks flows down per country, skipping inactive countries, with national prices", () => {
    const docs = buildCommodityFlowDocs(
      args({
        global: new Map([["iron", { supply: 100, demand: 150 }]]),
        byCountry: new Map([
          ["US", new Map([["iron", { supply: 80, demand: 100 }]])],
          ["UK", new Map([["iron", { supply: 20, demand: 50 }]])],
          ["DE", new Map([["iron", { supply: 0, demand: 0 }]])],
        ]),
        nationalPricesByCommodity: new Map([["iron", { US: 200, UK: 210 }]]),
      })
    );
    const d = docs[0];
    expect(Object.keys(d.byCountry).sort()).toEqual(["UK", "US"]);
    expect(d.byCountry.US).toEqual({ supply: 80, demand: 100, cleared: 80, price: 200 });
    expect(d.byCountry.UK.cleared).toBe(20);
    expect(d.byCountry.UK.price).toBe(210);
  });

  it("records the cover-cap write-down explicitly when enabled, omits it otherwise", () => {
    const overhang = {
      global: new Map<CommodityType, Balance>([["steel", { supply: 0, demand: 950_000 }]]),
      prevStockByCommodity: new Map<CommodityType, number>([["steel", 1.22e9]]),
    };
    const off = buildCommodityFlowDocs(args(overhang))[0];
    expect(off.excessSpoiledUnits).toBeUndefined();
    const on = buildCommodityFlowDocs(args({ ...overhang, coverCapEnabled: true }))[0];
    expect(on.excessSpoiledUnits).toBeGreaterThan(0);
    // Total spoilage includes the write-down; stock reflects both losses.
    expect(on.spoiledUnits).toBeGreaterThan(off.spoiledUnits);
    expect(on.stockUnits!).toBeLessThan(off.stockUnits!);
    expect(off.stockUnits! - on.stockUnits!).toBeCloseTo(on.excessSpoiledUnits!, 0);
  });

  it("rounds unit figures to 2dp", () => {
    const docs = buildCommodityFlowDocs(
      args({ global: new Map([["oil", { supply: 10.12345, demand: 20.98765 }]]) })
    );
    expect(docs[0].supplyUnits).toBe(10.12);
    expect(docs[0].demandUnits).toBe(20.99);
  });
});
