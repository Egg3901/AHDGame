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
  it("caps the owner at the cap share of book demand and records the refused share", () => {
    const results = computeClearingFactors(fixture());
    const a = 70 * results.get("a")!.soldByCommodity!.advertising!;
    const b = 30 * results.get("b")!.soldByCommodity!.advertising!;
    expect(a).toBeCloseTo(65);
    expect(b).toBe(30);
    expect(results.get("a")!.deliveredUnitsByCommodity!.advertising).toBeCloseTo(a);
    expect(results.get("a")!.factor).toBeCloseTo(a / 70);
    expect(results.get("a")!.regulationBlockedFraction).toBeCloseTo(5 / 70);
    expect(results.get("a")!.regulationBlockedByCommodity!.advertising).toBeCloseTo(5 / 70);
    expect(results.get("b")!).not.toHaveProperty("regulationBlockedFraction");
  });
  it("lets a sole seller serve up to the cap share of demand", () => {
    const args = fixture();
    args.sectors = args.sectors.slice(0, 1);
    args.balances = new Map([["advertising", { supply: 70, demand: 100 }]]);
    const results = computeClearingFactors(args);
    // Book demand 100: the owner may deliver 65 of its 70 units.
    expect(70 * results.get("a")!.soldFraction).toBeCloseTo(65);
    expect(results.get("a")!.regulationBlockedFraction).toBeCloseTo(5 / 70);
  });
  it("does not tie a dominant seller in a thin market to its small competitor", () => {
    const args = fixture();
    args.sectors = [70, 5].map((units, i) => ({
      ...args.sectors[i]!,
      outputUnitsByCommodity: { advertising: units },
    }));
    args.balances = new Map([["advertising", { supply: 75, demand: 100 }]]);
    const results = computeClearingFactors(args);
    expect(70 * results.get("a")!.soldFraction).toBeCloseTo(65);
    expect(5 * results.get("b")!.soldFraction).toBeCloseTo(5);
  });
  it("uses the state's own advertising demand when it is the larger audience", () => {
    const limits = new Map<string, number>();
    const args = fixture();
    args.mediaOwnership = {
      ...ownership,
      demandByState: new Map([["CA", 1000]]),
      limitUnitsByOwner: limits,
    };
    const results = computeClearingFactors(args);
    expect(results.get("a")!.soldFraction).toBe(1);
    expect(limits.get("CA:owner-a")).toBeCloseTo(650);
  });
  it("reduces contracted delivery too, so its settlement cannot pay excluded units", () => {
    const args = fixture();
    args.mediaOwnership = { ...ownership, shareCap: 0.35 };
    args.sectorCorpId = ownership.corporationBySector;
    args.contractedByCorpCommodity = new Map([["owner-a", new Map([["advertising", 50]])]]);
    args.contractSettlementOut = new Map();
    const results = computeClearingFactors(args);
    expect(70 * results.get("a")!.soldFraction).toBeCloseTo(35);
    expect(results.get("b")!.soldFraction).toBe(1);
    expect(args.contractSettlementOut.get("owner-a")!.get("advertising")).toBeCloseTo(35);
  });
  it("does not invent cheaper or undelivered rival sales to satisfy a cap", () => {
    const args = fixture();
    args.sectors = args.sectors.map((sector, index) => ({
      ...sector,
      posture: index === 0 ? -0.2 : 0.2,
    }));
    args.balances = new Map([["advertising", { supply: 100, demand: 50 }]]);
    const results = computeClearingFactors(args);
    // The cheap seller took the whole book; the law trims it to 65% of the
    // 50-unit audience and the refused units are not handed to the rival.
    expect(70 * results.get("a")!.soldFraction).toBeCloseTo(32.5);
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
