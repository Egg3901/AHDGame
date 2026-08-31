import { describe, it, expect } from "vitest";
import { advertisingDeliveredValueByCorp } from "./advertisingDeliveredValue";
import { TURNS_PER_DAY } from "@/lib/constants/corporations";

const BASE = { advertising: 2 } as { advertising: number } & Record<string, number>;
const mixWeight = () => 1;

function args(overrides: Partial<Parameters<typeof advertisingDeliveredValueByCorp>[0]> = {}) {
  return {
    inputs: [{ sectorId: "s1", supplyRates: { advertising: 0.5 }, revenue: 400 }],
    clearingBasePrices: BASE,
    plantsEnabled: false,
    clearingGroupBySector: new Map([["s1", "US"]]),
    clearingBySectorId: new Map([["s1", { soldByCommodity: { advertising: 0.5 } }]]),
    countryClearingBooks: new Map(),
    globalCommodityBalances: new Map(),
    priceRatioByCommodity: new Map([["advertising", 1]]),
    sectorCorpId: new Map([["s1", "corp1"]]),
    commodityMixWeight: mixWeight,
    qualityPremiumPricingEnabled: false,
    ...overrides,
  } as Parameters<typeof advertisingDeliveredValueByCorp>[0];
}

describe("advertisingDeliveredValueByCorp", () => {
  it("values only the units actually delivered, on the per-turn anchor basis", () => {
    // 400 revenue x 0.5 rate / 2 base = 100 units offered, half of them sold.
    const delivered = advertisingDeliveredValueByCorp(args());

    expect(delivered.get("corp1")).toBeCloseTo((50 * 2) / TURNS_PER_DAY, 10);
  });

  it("pays nothing to a seller that sold nothing", () => {
    const delivered = advertisingDeliveredValueByCorp(
      args({ clearingBySectorId: new Map([["s1", { soldByCommodity: { advertising: 0 } }]]) })
    );

    expect(delivered.size).toBe(0);
  });

  it("falls back to the global book when the country book lacks the commodity", () => {
    // The lagged supply book caps how many offered units count as delivered.
    // A country book with no advertising entry must fall through to the global
    // one; skipping normalization here would value units nobody delivered.
    const globalOnly = advertisingDeliveredValueByCorp(
      args({
        countryClearingBooks: new Map([["US", new Map()]]),
        globalCommodityBalances: new Map([["advertising", { supply: 40 }]]),
      })
    );

    // 100 offered units normalize to the 40 the book knows about, half sold.
    expect(globalOnly.get("corp1")).toBeCloseTo((20 * 2) / TURNS_PER_DAY, 10);
  });

  it("sums several sectors owned by the same corporation", () => {
    const delivered = advertisingDeliveredValueByCorp(
      args({
        inputs: [
          { sectorId: "s1", supplyRates: { advertising: 0.5 }, revenue: 400 },
          { sectorId: "s2", supplyRates: { advertising: 0.5 }, revenue: 400 },
        ],
        clearingGroupBySector: new Map([
          ["s1", "US"],
          ["s2", "US"],
        ]),
        clearingBySectorId: new Map([
          ["s1", { soldByCommodity: { advertising: 0.5 } }],
          ["s2", { soldByCommodity: { advertising: 0.5 } }],
        ]),
        sectorCorpId: new Map([
          ["s1", "corp1"],
          ["s2", "corp1"],
        ]),
      })
    );

    expect(delivered.get("corp1")).toBeCloseTo((100 * 2) / TURNS_PER_DAY, 10);
  });
});
