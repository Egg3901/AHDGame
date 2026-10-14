import { describe, expect, it } from "vitest";
import { buildOwnRoutes } from "./ownRoutes";
import { runSourcingPass } from "./sourcing";
import { buildSourcingDocs } from "./sourcingLedger";
import { computeClearingFactors } from "@/lib/market/clearing";
import { outputPlacementRatios } from "@/lib/market/rules/outputPlacement";
import { finishInternalSupplyContext } from "@/lib/turn/corporation/internalSupply";
import type { InternalSupplyClearing } from "@/lib/market/internalSupply/clearing";
import type { MarketContext } from "@/lib/market/marketContext";
import { COMMODITY_BASE_PRICES, type CommodityType } from "@/lib/constants/commodities";

type Balance = { supply: number; demand: number };
const balances = (coal: Balance, freight = 1000): Map<CommodityType, Balance> =>
  new Map([
    ["coal", coal],
    ["freight", { supply: freight, demand: 0 }],
  ]);
const sectors = [
  { sectorId: "near-mine", corporationId: "owner", stateId: "WY" },
  { sectorId: "far-mine", corporationId: "owner", stateId: "IL" },
  { sectorId: "factory", corporationId: "owner", stateId: "CA" },
];
const policies: InternalSupplyClearing["policies"] = new Map([
  [
    "owner",
    { root: "owner", policy: { priority: "own", discount: 0.2, ownFirstAcrossStates: true } },
  ],
]);

function pipeline(nearFreight: number, secondFactory = false) {
  const routes = buildOwnRoutes({
    sectors: secondFactory
      ? [...sectors, { sectorId: "factory-2", corporationId: "owner", stateId: "OR" }]
      : sectors,
    supplyBySector: new Map([
      ["near-mine", new Map([["coal", 100]])],
      ["far-mine", new Map([["coal", 200]])],
    ]),
    inputDemandBySector: new Map([
      ["factory", new Map([["coal", 100]])],
      ...(secondFactory ? [["factory-2", new Map([["coal" as const, 50]])] as const] : []),
    ]),
    policies,
    stateToCountry: new Map(["WY", "IL", "CA", "NY", "OR"].map((id) => [id, "US"])),
    hops: (_country, from, to) => (from === to ? 0 : from === "WY" ? 1 : 2),
  });
  const byState = new Map([
    ["WY", balances({ supply: 100, demand: 0 }, nearFreight)],
    ["IL", balances({ supply: 200, demand: 0 })],
    ["CA", balances({ supply: 0, demand: 100 })],
    ["NY", balances({ supply: 0, demand: 80 })],
    ["OR", balances({ supply: 0, demand: secondFactory ? 50 : 0 })],
  ]);
  const sourcing = runSourcingPass({
    states: [...byState.keys()].map((stateId) => ({ stateId, countryId: "US" as const })),
    byState,
    byCountry: new Map([["US", balances({ supply: 300, demand: secondFactory ? 230 : 180 })]]),
    statePricesFor: () => ({ WY: 90, IL: 100, CA: 100, NY: 100, OR: 100 }),
    nationalPricesFor: () => ({ US: 100 }),
    basePriceFor: () => 100,
    freightPrice: 10,
    hops: (_country, from, to) => (from === to ? 0 : from === "WY" ? 1 : 2),
    tariffRatePct: () => 0,
    isBlocked: () => false,
    ownRoutes: routes,
  });
  // Persisted network receipts are what the next corporation pass consumes.
  const { networkDoc } = buildSourcingDocs(sourcing, 10, new Date(0));
  networkDoc.ownRouteDelivered = sourcing.ownRouteDelivered;
  const own: InternalSupplyClearing = {
    policies,
    buyers: [
      {
        sectorId: "factory",
        corporationId: "owner",
        demand: new Map([["coal", 100]]),
        availability: new Map([["coal", 0.85]]),
      },
      ...(secondFactory
        ? [
            {
              sectorId: "factory-2",
              corporationId: "owner",
              demand: new Map<CommodityType, number>([["coal", 50]]),
              availability: new Map<CommodityType, number>([["coal", 0.85]]),
            },
          ]
        : []),
    ],
    deliveryStateBySector: new Map([
      ...sectors.map((s) => [s.sectorId, s.stateId] as const),
      ["factory-2", "OR"],
    ]),
    ownRouteDeliveredByKey: new Map(
      networkDoc.ownRouteDelivered.map((r) => [
        `${r.commodity}|${r.corporationId}|${r.originStateId}|${r.destStateId}`,
        r.units,
      ])
    ),
    availabilityOut: new Map(),
    discountCostOut: new Map(),
    tradesOut: [],
  };
  const cleared = computeClearingFactors({
    sectors: [
      {
        sectorId: "near-mine",
        revenue: 0,
        supplyRates: { coal: 1, timber: 0.01 },
        outputUnitsByCommodity: { coal: 100, timber: 10 },
        posture: 0,
        offerPlacementByCommodity: outputPlacementRatios(
          { coal: 1, timber: 0.01 },
          new Map([
            ["coal", nearFreight > 0 ? 1 : 0],
            ["timber", 0],
          ])
        ),
      },
      {
        sectorId: "far-mine",
        revenue: 0,
        supplyRates: { coal: 1 },
        producedUnits: 200,
        posture: 0,
      },
    ],
    balances: new Map([
      ["coal", { supply: 300, demand: secondFactory ? 230 : 180 }],
      ["timber", { supply: 10, demand: 0 }],
    ]),
    priceRatioByCommodity: new Map(),
    basePrices: COMMODITY_BASE_PRICES,
    plantsEnabled: true,
    sectorCorpId: new Map([
      ["near-mine", "owner"],
      ["far-mine", "owner"],
    ]),
    internalSupply: own,
    recordDelivery: true,
  });
  const market = {} as MarketContext;
  finishInternalSupplyContext(own, market, 11);
  return { sourcing, cleared, own, market };
}

describe("own supply through routing, settlement and plant receipts", () => {
  it("falls back when the nearer mine cannot haul, then sells spare coal to another state", () => {
    const { sourcing, own, market } = pipeline(0);
    expect(sourcing.ownRouteDelivered.map((r) => r.originStateId)).toEqual(["IL"]);
    expect(market.internalSupplyReceiptsBySectorId?.get("factory")?.received.coal).toBeCloseTo(100);
    expect(own.availabilityOut.get("factory")?.get("coal")).toBe(1);
    expect(
      sourcing.flows
        .filter((f) => f.commodity === "coal" && f.destStateId === "NY")
        .reduce((n, f) => n + f.units, 0)
    ).toBeCloseTo(80);
    const summary = sourcing.summaries.find((s) => s.commodity === "coal")!;
    expect(
      summary.intraStateUnits + summary.interStateUnits + summary.importUnits + summary.unmetUnits
    ).toBeCloseTo(180);
    const billed =
      sourcing.ownRouteDelivered.reduce((n, r) => n + (r.freightCharge ?? 0), 0) +
      [...sourcing.freightChargesByDestState.values()].reduce(
        (n, m) => n + (m.get("coal") ?? 0),
        0
      );
    expect(billed).toBeCloseTo(
      [...sourcing.haulRevenueByOriginState.values()].reduce((n, v) => n + v, 0)
    );
    expect([...own.discountCostOut.values()].reduce((n, v) => n + v, 0)).toBeCloseTo(0);
  });
  it("does not let an unsold byproduct erase delivered own coal", () => {
    const { market, cleared } = pipeline(1000);
    expect(market.internalSupplyReceiptsBySectorId?.get("factory")?.received.coal).toBeCloseTo(100);
    expect(cleared.get("near-mine")?.deliveredUnitsByCommodity?.coal).toBeCloseTo(100);
    expect(cleared.get("near-mine")?.deliveredUnitsByCommodity?.timber).toBe(0);
  });
  it("uses a farther mine for the part a nearer mine cannot transport", () => {
    const { sourcing, market } = pipeline(1);
    const routes = sourcing.ownRouteDelivered;
    expect(routes.map((r) => r.originStateId)).toEqual(["WY", "IL"]);
    expect(routes[0]!.units).toBeGreaterThan(0);
    expect(routes[0]!.units).toBeLessThan(100);
    expect(routes.reduce((n, r) => n + r.units, 0)).toBeCloseTo(100);
    expect(market.internalSupplyReceiptsBySectorId?.get("factory")?.received.coal).toBeCloseTo(100);
  });
  it("shares fallback supply across plants without reserving or delivering it twice", () => {
    const { sourcing, market } = pipeline(0, true);
    expect(sourcing.ownRouteDelivered.reduce((n, r) => n + r.units, 0)).toBeCloseTo(150);
    expect(market.internalSupplyReceiptsBySectorId?.get("factory")?.received.coal).toBeCloseTo(100);
    expect(market.internalSupplyReceiptsBySectorId?.get("factory-2")?.received.coal).toBeCloseTo(
      50
    );
    expect(sourcing.ownRouteDelivered.every((r) => r.originStateId === "IL")).toBe(true);
  });
});
