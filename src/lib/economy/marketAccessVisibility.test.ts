import { describe, expect, it } from "vitest";
import type { CommodityType } from "@/lib/constants/commodities";
import type { MarketFormationSnapshot } from "@/lib/db/types/marketFormation";
import type { StockVsFlowByKind } from "@/lib/ledger/types";
import type { CommoditySourcingDoc, SourcingNetworkDoc } from "@/lib/logistics/sourcingLedger";
import {
  computeMarketAccessVisibility,
  summarizeResidentDemandSplit,
  summarizeStockVsFlowDivergence,
} from "./marketAccessVisibility";

function networkDoc(overrides: Partial<SourcingNetworkDoc> = {}): SourcingNetworkDoc {
  return {
    turn: 440,
    freightTeuByState: {},
    landedPremiums: {},
    importAggregates: {},
    createdAt: new Date("2026-08-28T00:00:00.000Z"),
    ...overrides,
  };
}

/** `landedPremiums` is a total Record over every commodity; a test row is partial. */
const premiums = (record: Partial<Record<CommodityType, number>>): Record<CommodityType, number> =>
  record as Record<CommodityType, number>;

const prices = (record: Partial<Record<CommodityType, number>>): Record<CommodityType, number> =>
  record as Record<CommodityType, number>;

function commodityDoc(
  overrides: Partial<CommoditySourcingDoc> & { commodity: CommodityType }
): CommoditySourcingDoc {
  return {
    basis: "buyer_intent_sourcing",
    turn: 440,
    demandUnitsIntent: 0,
    intraStateUnits: 0,
    interStateUnits: 0,
    importUnits: 0,
    tariffPaid: 0,
    unmetUnits: 0,
    toleranceBoundUnits: 0,
    capacityBoundUnits: 0,
    shortageResponsiveUnits: 0,
    flows: [],
    itemizedFlowCount: 0,
    totalFlowCount: 0,
    createdAt: new Date("2026-08-28T00:00:00.000Z"),
    ...overrides,
  };
}

function flow(
  originType: "state" | "country",
  originId: string,
  destStateId: string,
  units: number
): CommoditySourcingDoc["flows"][number] {
  return {
    originType,
    originId,
    destStateId,
    units,
    hops: originType === "country" ? 6 : 2,
    freightClass: "bulk",
    ask: 1,
    shippingPerUnit: 0.1,
    tariffRatePct: 0,
    tariffPaid: 0,
    landedPrice: 1.1,
    freightTeuConsumed: 1,
  };
}

describe("computeMarketAccessVisibility", () => {
  it("returns empty/null readings — never fabricated zeros — when nothing was supplied", () => {
    const view = computeMarketAccessVisibility({});
    expect(view.deliveredPrice).toEqual([]);
    expect(view.topRoutes).toEqual([]);
    expect(view.residentDemandSplit).toBeNull();
    expect(view.routeMix).toEqual({
      intraStateUnits: 0,
      interstateUnits: 0,
      importUnits: 0,
      deliveredUnits: 0,
      intraStateShare: null,
      interstateShare: null,
      importShare: null,
    });
  });

  it("summarizes the delivered price as anchor + mean landed premium over the base", () => {
    const view = computeMarketAccessVisibility({
      globalPrices: prices({ coal: 10 }),
      basePrices: prices({ coal: 8 }),
      network: networkDoc({
        landedPremiums: { A1: premiums({ coal: 2 }), A2: premiums({ coal: 4 }) },
        freightCharges: { A1: { coal: 100 }, A3: { coal: 50 } },
        importAggregates: {},
      }),
    });
    expect(view.deliveredPrice).toEqual([
      {
        commodity: "coal",
        globalPriceAnchor: 10,
        basePrice: 8,
        landedPremiumPerUnit: 3,
        deliveredPricePerUnit: 13,
        deliveredToBaseMultiple: 1.625,
        freightChargeAnchor: 150,
        premiumStates: 2,
      },
    ]);
  });

  it("treats a present network doc with no premium as a zero premium (delivered at anchor)", () => {
    const view = computeMarketAccessVisibility({
      globalPrices: { oil: 5 },
      network: networkDoc({ landedPremiums: {} }),
    });
    const oil = view.deliveredPrice.find((row) => row.commodity === "oil")!;
    expect(oil.landedPremiumPerUnit).toBe(0);
    expect(oil.deliveredPricePerUnit).toBe(5);
    // Billing field absent on the doc -> unmeasured, not zero.
    expect(oil.freightChargeAnchor).toBeNull();
  });

  it("leaves the delivered price null when the premium input is missing, not zero", () => {
    const view = computeMarketAccessVisibility({
      globalPrices: { oil: 5 },
      basePrices: { oil: 4 },
      network: null,
    });
    const oil = view.deliveredPrice.find((row) => row.commodity === "oil")!;
    expect(oil.globalPriceAnchor).toBe(5);
    expect(oil.landedPremiumPerUnit).toBeNull();
    expect(oil.deliveredPricePerUnit).toBeNull();
    expect(oil.deliveredToBaseMultiple).toBeNull();
    expect(oil.freightChargeAnchor).toBeNull();
  });

  it("nulls the base multiple when no positive base price exists", () => {
    const view = computeMarketAccessVisibility({
      globalPrices: prices({ steel: 20 }),
      network: networkDoc({ landedPremiums: { A1: premiums({ steel: 1 }) } }),
    });
    const steel = view.deliveredPrice.find((row) => row.commodity === "steel")!;
    expect(steel.deliveredPricePerUnit).toBe(21);
    expect(steel.basePrice).toBeNull();
    expect(steel.deliveredToBaseMultiple).toBeNull();
  });

  it("derives the route mix shares from the state-sourced flow totals", () => {
    const view = computeMarketAccessVisibility({
      commodityDocs: [
        commodityDoc({
          commodity: "coal",
          intraStateUnits: 50,
          interStateUnits: 30,
          importUnits: 20,
        }),
        commodityDoc({ commodity: "oil", intraStateUnits: 0, interStateUnits: 40, importUnits: 0 }),
      ],
    });
    expect(view.routeMix).toEqual({
      intraStateUnits: 50,
      interstateUnits: 70,
      importUnits: 20,
      deliveredUnits: 140,
      intraStateShare: 50 / 140,
      interstateShare: 70 / 140,
      importShare: 20 / 140,
    });
  });

  it("ranks the top origin→destination routes by delivered units, aggregated across commodities", () => {
    const view = computeMarketAccessVisibility({
      topRouteLimit: 2,
      commodityDocs: [
        commodityDoc({
          commodity: "coal",
          flows: [flow("state", "A1", "B1", 10), flow("country", "C1", "B2", 20)],
        }),
        commodityDoc({ commodity: "oil", flows: [flow("state", "A1", "B1", 5)] }),
      ],
    });
    expect(view.topRoutes).toEqual([
      { originType: "country", originId: "C1", destStateId: "B2", units: 20 },
      { originType: "state", originId: "A1", destStateId: "B1", units: 15 },
    ]);
  });

  it("rolls up the resident-vs-local-producer demand split from the snapshot", () => {
    const marketFormation = {
      coverageByState: [
        { stateId: "A", residentDemandValue: 100, localProducerDemandValue: 50 },
        { stateId: "B", residentDemandValue: 200, localProducerDemandValue: 100 },
        { stateId: "C", residentDemandValue: 300, localProducerDemandValue: 150 },
      ],
    } as unknown as MarketFormationSnapshot;
    const view = computeMarketAccessVisibility({ marketFormation });
    expect(view.residentDemandSplit).toEqual({
      statesObserved: 3,
      totalResidentDemandValue: 600,
      totalLocalProducerDemandValue: 300,
      medianResidentDemandValue: 200,
      medianLocalProducerDemandValue: 100,
      localAbsorptionShare: 0.5,
    });
  });
});

describe("summarizeResidentDemandSplit", () => {
  it("returns null without a snapshot or without observed states", () => {
    expect(summarizeResidentDemandSplit(null)).toBeNull();
    expect(summarizeResidentDemandSplit(undefined)).toBeNull();
    expect(summarizeResidentDemandSplit({ coverageByState: [] })).toBeNull();
  });

  it("nulls the absorption share when the resident total is zero", () => {
    const split = summarizeResidentDemandSplit({
      coverageByState: [
        { residentDemandValue: 0, localProducerDemandValue: 0 },
        { residentDemandValue: 0, localProducerDemandValue: 0 },
      ] as MarketFormationSnapshot["coverageByState"],
    });
    expect(split).not.toBeNull();
    expect(split!.totalResidentDemandValue).toBe(0);
    expect(split!.localAbsorptionShare).toBeNull();
  });
});

describe("summarizeStockVsFlowDivergence", () => {
  const byKind: StockVsFlowByKind[] = [
    { kind: "character", divergentCount: 3, absDivergence: 100, uninstrumentedCount: 1 },
    { kind: "corporation", divergentCount: 2, absDivergence: 400, uninstrumentedCount: 0 },
  ];

  it("returns null when the inventory was never recorded", () => {
    expect(summarizeStockVsFlowDivergence(null)).toBeNull();
    expect(summarizeStockVsFlowDivergence(undefined)).toBeNull();
  });

  it("totals the divergent count and ranks kinds by absolute divergence", () => {
    const summary = summarizeStockVsFlowDivergence(byKind);
    expect(summary).not.toBeNull();
    expect(summary!).toEqual({
      totalDivergentCount: 5,
      totalAbsDivergence: 500,
      topKinds: [
        { kind: "corporation", divergentCount: 2, absDivergence: 400, uninstrumentedCount: 0 },
        { kind: "character", divergentCount: 3, absDivergence: 100, uninstrumentedCount: 1 },
      ],
    });
  });

  it("respects the top-k limit and reads an empty inventory as zero divergences", () => {
    expect(summarizeStockVsFlowDivergence(byKind, 1)?.topKinds).toEqual([
      { kind: "corporation", divergentCount: 2, absDivergence: 400, uninstrumentedCount: 0 },
    ]);
    expect(summarizeStockVsFlowDivergence([])).toEqual({
      totalDivergentCount: 0,
      totalAbsDivergence: 0,
      topKinds: [],
    });
  });
});
