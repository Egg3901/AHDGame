import { describe, expect, it } from "vitest";
import { computeClearingFactors, type SectorClearingInput } from "../clearing";
import { COMMODITY_BASE_PRICES } from "@/lib/constants/commodities";
import { resolveSupplyPolicies } from "./rules";
import type { InternalSupplyClearing } from "./clearing";
const sectors: SectorClearingInput[] = [
  { sectorId: "mine", revenue: 60000, supplyRates: { iron: 1 }, posture: 0.2, producedUnits: 60 },
  { sectorId: "rival", revenue: 40000, supplyRates: { iron: 1 }, posture: -0.2, producedUnits: 40 },
];
function context(): InternalSupplyClearing {
  return {
    policies: resolveSupplyPolicies([
      {
        id: "owner",
        totalShares: 1,
        holders: [{ shares: 1 }],
        policy: { priority: "own", discount: 0.1 },
      },
    ]),
    buyers: [
      { sectorId: "factory", corporationId: "owner", demand: new Map([["iron", 30]]) },
      { sectorId: "outside", corporationId: "other", demand: new Map([["iron", 120]]) },
    ],
    availabilityOut: new Map(),
    discountCostOut: new Map(),
    tradesOut: [],
  };
}
const args = {
  sectors,
  balances: new Map([["iron" as const, { supply: 100, demand: 50 }]]),
  priceRatioByCommodity: new Map(),
  basePrices: COMMODITY_BASE_PRICES,
  plantsEnabled: true,
  sectorCorpId: new Map([
    ["mine", "owner"],
    ["rival", "rival"],
  ]),
};
describe("internal supply inside real clearing", () => {
  it("reserves the premium seller then clears surplus cheapest-first", () => {
    const base = computeClearingFactors(args);
    const own = context();
    const result = computeClearingFactors({ ...args, internalSupply: own });
    expect(base.get("mine")?.soldFraction).toBeCloseTo(1 / 6);
    expect(result.get("mine")?.soldFraction).toBe(0.5);
    expect(result.get("rival")?.soldFraction).toBe(0.5);
    expect(own.tradesOut[0]?.units).toBe(30);
    expect(own.availabilityOut.get("factory")?.get("iron")).toBe(1);
    expect([...own.discountCostOut.values()].reduce((n, c) => n + c, 0)).toBeCloseTo(0);
    expect(60 * result.get("mine")!.soldFraction + 40 * result.get("rival")!.soldFraction).toBe(50);
  });
  it("never reserves across reachable country or freight-state books", () => {
    const own = context();
    computeClearingFactors({
      ...args,
      internalSupply: own,
      groupBySector: new Map([
        ["mine", "US"],
        ["factory", "UK"],
        ["outside", "US"],
      ]),
    });
    expect(own.tradesOut).toEqual([]);
    const freight = context();
    freight.buyers[0]!.demand = new Map([["freight", 30]]);
    computeClearingFactors({
      ...args,
      sectors: [{ ...sectors[0]!, supplyRates: { freight: 1 } }],
      internalSupply: freight,
      stateMarkets: {
        stateBySector: new Map([
          ["mine", "MN"],
          ["factory", "CA"],
        ]),
        balances: new Map([["MN", new Map([["freight", { supply: 60, demand: 50 }]])]]),
        priceRatios: new Map(),
      },
    });
    expect(freight.tradesOut).toEqual([]);
  });
  it("keeps existing agreement settlement separate from internal reservations", () => {
    const own = context();
    const settlement = new Map();
    const r = computeClearingFactors({
      ...args,
      internalSupply: own,
      contractedByCorpCommodity: new Map([["owner", new Map([["iron", 40]])]]),
      contractSettlementOut: settlement,
    });
    expect(own.tradesOut.reduce((n, t) => n + t.units, 0)).toBe(10);
    expect(settlement.get("owner").get("iron")).toBe(40);
    expect(r.get("mine")?.soldFraction).toBeCloseTo(50 / 60);
  });
  it("preserves all factors when no policy is active", () => {
    const own = context();
    own.policies = new Map();
    expect(computeClearingFactors({ ...args, internalSupply: own })).toEqual(
      computeClearingFactors(args)
    );
  });
});

it("does not reserve or discount media output refused by an ownership cap", () => {
  const own = context();
  own.buyers = [
    { sectorId: "factory", corporationId: "owner", demand: new Map([["advertising", 80]]) },
  ];
  const result = computeClearingFactors({
    ...args,
    sectors: [
      {
        sectorId: "mine",
        revenue: 100,
        supplyRates: { advertising: 1 },
        outputUnitsByCommodity: { advertising: 100 },
        posture: 0,
      },
    ],
    balances: new Map([["advertising", { supply: 100, demand: 100 }]]),
    internalSupply: own,
    mediaOwnership: {
      shareCap: 0.35,
      stateBySector: new Map([["mine", "CA"]]),
      corporationBySector: new Map([["mine", "owner"]]),
    },
  });
  expect(result.get("mine")?.soldFraction).toBe(0.35);
  expect(own.tradesOut.reduce((n, t) => n + t.units, 0)).toBe(35);
  expect(own.availabilityOut.get("factory")?.get("advertising")).toBeCloseTo(35 / 80);
  expect(own.discountCostOut.get("mine")).toBeCloseTo(
    (35 * COMMODITY_BASE_PRICES.advertising * 0.1) / 24
  );
});
