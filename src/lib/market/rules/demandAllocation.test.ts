import { describe, expect, it } from "vitest";
import { normalizedOfferShare } from "./demandAllocation";
import { computeClearingFactors } from "../clearing";
import { COMMODITY_BASE_PRICES, type CommodityType } from "@/lib/constants/commodities";

describe("normalized offer shares", () => {
  it("allocates independently within reachable country books", () => {
    const results = computeClearingFactors({
      sectors: [
        { sectorId: "a", producedUnits: 10, revenue: 100, supplyRates: { steel: 1 }, posture: 0 },
        { sectorId: "b", producedUnits: 30, revenue: 300, supplyRates: { steel: 1 }, posture: 0 },
        { sectorId: "c", producedUnits: 10, revenue: 100, supplyRates: { steel: 1 }, posture: 0 },
      ],
      plantsEnabled: true,
      balances: new Map(),
      basePrices: COMMODITY_BASE_PRICES,
      priceRatioByCommodity: new Map(),
      groupBySector: new Map([
        ["a", "US"],
        ["b", "US"],
        ["c", "JP"],
      ]),
      balancesByGroup: new Map([
        [
          "US",
          new Map<CommodityType, { supply: number; demand: number }>([
            ["steel", { supply: 40, demand: 80 }],
          ]),
        ],
        [
          "JP",
          new Map<CommodityType, { supply: number; demand: number }>([
            ["steel", { supply: 10, demand: 20 }],
          ]),
        ],
      ]),
    });
    expect(results.get("a")!.marketSupplyShareByCommodity!.steel).toBe(0.25);
    expect(results.get("b")!.marketSupplyShareByCommodity!.steel).toBe(0.75);
    expect(results.get("c")!.marketSupplyShareByCommodity!.steel).toBe(1);
  });
  it("does not let idle sellers or another state claim a local freight book", () => {
    const results = computeClearingFactors({
      sectors: [
        { sectorId: "a", producedUnits: 10, revenue: 100, supplyRates: { freight: 1 }, posture: 0 },
        {
          sectorId: "idle",
          producedUnits: 0,
          revenue: 100,
          supplyRates: { freight: 1 },
          posture: 0,
        },
        { sectorId: "b", producedUnits: 30, revenue: 300, supplyRates: { freight: 1 }, posture: 0 },
      ],
      plantsEnabled: true,
      balances: new Map(),
      basePrices: COMMODITY_BASE_PRICES,
      priceRatioByCommodity: new Map(),
      stateMarkets: {
        stateBySector: new Map([
          ["a", "CA"],
          ["idle", "CA"],
          ["b", "NY"],
        ]),
        balances: new Map([
          [
            "CA",
            new Map<CommodityType, { supply: number; demand: number }>([
              ["freight", { supply: 10, demand: 80 }],
            ]),
          ],
          [
            "NY",
            new Map<CommodityType, { supply: number; demand: number }>([
              ["freight", { supply: 30, demand: 40 }],
            ]),
          ],
        ]),
        priceRatios: new Map(),
      },
    });
    expect(results.get("a")!.marketSupplyShareByCommodity!.freight).toBe(1);
    expect(results.get("idle")!.marketSupplyShareByCommodity!.freight).toBe(0);
    expect(results.get("b")!.marketSupplyShareByCommodity!.freight).toBe(1);
  });
  it("leaves the rest of a book to unowned/non-corporate suppliers", () => {
    expect(normalizedOfferShare(20, 40, 100)).toBe(0.2);
    expect(normalizedOfferShare(20, 40, 0)).toBe(0.5);
  });
  it("rejects invalid data and caps any single allocation", () => {
    expect(normalizedOfferShare(NaN, 40, 100)).toBe(0);
    expect(normalizedOfferShare(0, 0, 0)).toBe(0);
    expect(normalizedOfferShare(-20, 40, 100)).toBe(0);
    expect(normalizedOfferShare(100, 40, 80)).toBe(1);
  });
});
