import { describe, expect, it } from "vitest";
import { COMMODITY_BASE_PRICES } from "@/lib/constants/commodities";
import { computeClearingFactors } from "./clearing";

const ownership = {
  shareCap: 0.65,
  stateBySector: new Map([
    ["a", "CA"],
    ["b", "CA"],
  ]),
  corporationBySector: new Map([
    ["a", "owner-a"],
    ["b", "owner-b"],
  ]),
};
function fixture(): Parameters<typeof computeClearingFactors>[0] {
  return {
    sectors: [70, 30].map((units, i) => ({
      sectorId: i === 0 ? "a" : "b",
      revenue: 100,
      supplyRates: { advertising: 1 },
      outputUnitsByCommodity: { advertising: units },
      posture: 0,
    })),
    balances: new Map([["advertising", { supply: 100, demand: 100 }]]),
    priceRatioByCommodity: new Map([["advertising", 1]]),
    basePrices: COMMODITY_BASE_PRICES,
    recordDelivery: true,
    plantsEnabled: true,
    mediaOwnership: ownership,
  };
}
describe("enacted media delivery cap in clearing", () => {
  it("reduces actual volume and revenue under the final delivered denominator", () => {
    const results = computeClearingFactors(fixture());
    const a = 70 * results.get("a")!.soldByCommodity!.advertising!;
    const b = 30 * results.get("b")!.soldByCommodity!.advertising!;
    expect(a / (a + b)).toBeCloseTo(0.65);
    expect(b).toBe(30);
    expect(results.get("a")!.deliveredUnitsByCommodity!.advertising).toBeCloseTo(a);
    expect(results.get("a")!.factor).toBeCloseTo(a / 70);
    expect(a + b).toBeLessThan(100);
  });
  it("reduces contracted delivery too, so its settlement cannot pay excluded units", () => {
    const args = fixture();
    args.mediaOwnership = { ...ownership, shareCap: 0.35 };
    args.sectorCorpId = ownership.corporationBySector;
    args.contractedByCorpCommodity = new Map([["owner-a", new Map([["advertising", 50]])]]);
    args.contractSettlementOut = new Map();
    const results = computeClearingFactors(args);
    expect(results.get("a")!.soldFraction).toBe(0);
    expect(results.get("b")!.soldFraction).toBe(0);
    expect(args.contractSettlementOut.size).toBe(0);
  });
  it("does not invent cheaper or undelivered rival sales to satisfy a cap", () => {
    const args = fixture();
    args.sectors = args.sectors.map((sector, index) => ({
      ...sector,
      posture: index === 0 ? -0.2 : 0.2,
    }));
    args.balances = new Map([["advertising", { supply: 100, demand: 50 }]]);
    const results = computeClearingFactors(args);
    expect(results.get("a")!.soldFraction).toBe(0);
    expect(results.get("b")!.soldFraction).toBe(0);
  });
  it("preserves ordinary fills without the enabled ownership context", () => {
    const args = fixture();
    delete args.mediaOwnership;
    delete args.recordDelivery;
    const results = computeClearingFactors(args);
    expect(results.get("a")!).not.toHaveProperty("deliveredUnitsByCommodity");
    expect(results.get("a")!.soldFraction).toBe(1);
    expect(results.get("b")!.soldFraction).toBe(1);
  });
});
