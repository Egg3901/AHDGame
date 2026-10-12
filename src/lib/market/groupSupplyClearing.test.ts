import { resolveSupplyPolicies } from "./internalSupply/rules";
import { describe, it, expect } from "vitest";
import { computeClearingFactors } from "./clearing";
import { COMMODITY_BASE_PRICES, eraScaledBasePrices } from "@/lib/constants/commodities";
import { coordinationFixture } from "@/lib/corporations/groups/rules/testFixtures";
import type { GroupForecastBasis } from "@/lib/corporations/groups/rules/forecast";
function clearingFixture(scale = 1) {
  const f = coordinationFixture();
  f.buyers = [{ ...f.buyers[0], requiredUnits: 30 }];
  const context: NonNullable<Parameters<typeof computeClearingFactors>[0]["groupSupply"]> = {
    turn: 10,
    freightSettlementActive: false,
    members: f.members,
    buyersByCommodity: new Map([["steel", f.buyers]]),
    locationBySector: new Map([["ss", { countryId: "US", stateId: "CA" }]]),
    physicalBySectorCommodity: new Map([["ss", new Map([["steel", 100]])]]),
    receipts: [],
    availabilityBySector: new Map(),
    inputAllocationsBySector: new Map(),
  };
  const args: Parameters<typeof computeClearingFactors>[0] = {
    sectors: [
      {
        sectorId: "ss",
        revenue: COMMODITY_BASE_PRICES.steel * 100,
        supplyRates: { steel: 1 },
        producedUnits: 100,
        posture: 0.2,
      },
      {
        sectorId: "public",
        revenue: COMMODITY_BASE_PRICES.steel * 100,
        supplyRates: { steel: 1 },
        producedUnits: 100,
        posture: 0,
      },
    ],
    balances: new Map([["steel", { supply: 200, demand: 50 }]]),
    priceRatioByCommodity: new Map([["steel", 1]]),
    basePrices: eraScaledBasePrices(scale),
    plantsEnabled: true,
    sectorCorpId: new Map([
      ["ss", "s"],
      ["public", "outside"],
    ]),
    groupSupply: context,
  };
  return { args, context };
}
describe("group supply in the actual clearing pass", () => {
  it("reserves finite NPP output at exactly the benchmark and leaves the residual public", () => {
    const { args, context } = clearingFixture();
    const results = computeClearingFactors(args);
    expect(context.receipts).toHaveLength(1);
    expect(context.receipts[0].units).toBeCloseTo(30);
    expect(results.get("ss")!.factor).toBeCloseTo(0.3);
    expect(results.get("public")!.soldFraction).toBeCloseTo(0.2);
    expect(context.receipts[0].amountAnchor).toBeCloseTo((30 * COMMODITY_BASE_PRICES.steel) / 24);
  });
  it("honors existing agreements before group allocation and does not duplicate settlement units", () => {
    const { args, context } = clearingFixture();
    args.contractedByCorpCommodity = new Map([["s", new Map([["steel", 20]])]]);
    args.contractSettlementOut = new Map();
    const result = computeClearingFactors(args);
    expect(context.receipts[0].units).toBeCloseTo(30);
    expect(args.contractSettlementOut.get("s")!.get("steel")).toBeCloseTo(20);
    expect(result.get("ss")!.factor).toBeCloseTo(0.54);
    expect(result.get("public")!.soldFraction).toBeCloseTo(0);
  });
  it("uses the correct era units for the single input-cost rail", () => {
    const { args, context } = clearingFixture(100);
    computeClearingFactors(args);
    expect(context.inputAllocationsBySector!.get("bb")!.get("steel")!.units).toBeCloseTo(
      30 / 100 / 24
    );
    expect(context.inputAllocationsBySector!.get("bb")!.get("steel")!.marketFactor).toBe(1);
  });
  it("keeps independent policy and a missing coordination context byte-equivalent", () => {
    const { args, context } = clearingFixture();
    context.activeRoots = new Set();
    const independent = computeClearingFactors(args);
    args.groupSupply = undefined;
    expect(computeClearingFactors(args)).toEqual(independent);
    expect(context.receipts).toEqual([]);
  });
  it("captures only bounded group rows for private forecasts", () => {
    const { args, context } = clearingFixture();
    const basis: GroupForecastBasis = {
      turn: 10,
      rootId: "r",
      memberIds: ["s", "b"],
      cashByMember: {},
      books: [],
      complete: true,
    };
    context.forecastByRoot = new Map([["r", basis]]);
    computeClearingFactors(args);
    expect(basis.books).toHaveLength(1);
    expect(basis.books[0].sellers.map((s) => s.memberId)).toEqual(["s"]);
    expect(basis.books[0].buyers.map((b) => b.memberId)).toEqual(["b"]);
    basis.books = Array.from({ length: 128 }, () => basis.books[0]);
    computeClearingFactors({
      ...args,
      groupSupply: { ...context, receipts: [], availabilityBySector: new Map() },
    });
    expect(basis.complete).toBe(false);
    expect(basis.books).toHaveLength(128);
  });
});

it("never combines Group allocations with the older internal priority reservations or discounts", () => {
  const { args, context } = clearingFixture();
  args.internalSupply = {
    policies: resolveSupplyPolicies([
      {
        id: "s",
        totalShares: 1,
        holders: [{ shares: 1 }],
        policy: { priority: "own", discount: 0.2 },
      },
    ]),
    buyers: [{ sectorId: "ownBuyer", corporationId: "s", demand: new Map([["steel", 100]]) }],
    availabilityOut: new Map(),
    discountCostOut: new Map(),
    tradesOut: [],
  };
  const expected = computeClearingFactors({ ...args, internalSupply: undefined });
  context.receipts.length = 0;
  context.availabilityBySector.clear();
  context.inputAllocationsBySector?.clear();
  expect(computeClearingFactors(args)).toEqual(expected);
  expect(context.receipts).toHaveLength(1);
  expect(args.internalSupply.tradesOut).toEqual([]);
  expect(args.internalSupply.discountCostOut.size).toBe(0);
});
