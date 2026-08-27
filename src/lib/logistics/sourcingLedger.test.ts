import { describe, expect, it } from "vitest";
import type { SourcingResult } from "./sourcing";
import { buildSourcingDocs } from "./sourcingLedger";
import type { CommodityType } from "@/lib/constants/commodities";

function baseResult(overrides: Partial<SourcingResult> = {}): SourcingResult {
  return {
    flows: [],
    summaries: [],
    freightTeuByState: new Map(),
    freightDemandTeuByState: new Map(),
    landedPremiumByDestState: new Map(),
    importAggregatesByCountry: new Map(),
    unplacedSupplyByState: new Map(),
    deliveryLimitedSupplyByState: new Map(),
    freightChargesByDestState: new Map(),
    haulRevenueByOriginState: new Map(),
    ...overrides,
  };
}

describe("buildSourcingDocs", () => {
  it("persists the buyer-intent denominator and basis marker", () => {
    const result: SourcingResult = {
      flows: [],
      summaries: [
        {
          commodity: "energy",
          intraStateUnits: 10,
          interStateUnits: 20,
          importUnits: 30,
          tariffPaid: 0,
          unmetUnits: 40,
          toleranceBoundUnits: 5,
          capacityBoundUnits: 6,
          shortageResponsiveUnits: 7,
          congestionUnits: 0,
          congestionSurchargePaid: 0,
          gridLossUnits: 0,
        },
      ],
      freightTeuByState: new Map(),
      freightDemandTeuByState: new Map(),
      landedPremiumByDestState: new Map(),
      importAggregatesByCountry: new Map(),
      unplacedSupplyByState: new Map(),
      deliveryLimitedSupplyByState: new Map(),
      freightChargesByDestState: new Map(),
      haulRevenueByOriginState: new Map(),
    };

    const { commodityDocs } = buildSourcingDocs(result, 365, new Date("2026-08-25T00:00:00.000Z"));
    const persisted = JSON.parse(JSON.stringify(commodityDocs[0]));

    expect(persisted.basis).toBe("buyer_intent_sourcing");
    expect(persisted.demandUnitsIntent).toBe(100);
    expect(persisted.unmetUnits).toBe(40);
    expect(persisted.shortageResponsiveUnits).toBe(7);
  });

  it("rounds premiumPerUnit to 4 decimals and omits zero/negative entries", () => {
    const landedPremiumByDestState = new Map<
      string,
      Map<CommodityType, { metUnits: number; extraCost: number }>
    >([
      [
        "A1",
        new Map([
          ["coal", { metUnits: 100, extraCost: 40.00006 }], // premium 0.4000006 -> 0.4
          ["oil", { metUnits: 100, extraCost: 0 }], // premium 0 -> omitted
          ["steel", { metUnits: 0, extraCost: 50 }], // metUnits <= 0 -> omitted
        ]),
      ],
    ]);
    const { networkDoc } = buildSourcingDocs(
      baseResult({ landedPremiumByDestState }),
      10,
      new Date()
    );
    expect(networkDoc.landedPremiums.A1).toEqual({ coal: 0.4 });
    expect(networkDoc.landedPremiums.A1.oil).toBeUndefined();
    expect(networkDoc.landedPremiums.A1.steel).toBeUndefined();
  });

  it("omits a state entirely when every commodity premium is omitted", () => {
    const landedPremiumByDestState = new Map<
      string,
      Map<CommodityType, { metUnits: number; extraCost: number }>
    >([["A1", new Map([["coal", { metUnits: 100, extraCost: 0 }]])]]);
    const { networkDoc } = buildSourcingDocs(
      baseResult({ landedPremiumByDestState }),
      10,
      new Date()
    );
    expect(networkDoc.landedPremiums.A1).toBeUndefined();
  });

  it("rounds importAggregates to 2 decimals and omits zero entries", () => {
    const importAggregatesByCountry = new Map([
      ["US", { tariffPaid: 12.3456, importValue: 100.005 }],
      ["UK", { tariffPaid: 0, importValue: 0 }],
    ]);
    const { networkDoc } = buildSourcingDocs(
      baseResult({ importAggregatesByCountry }),
      10,
      new Date()
    );
    expect(networkDoc.importAggregates.US).toEqual({ tariffPaid: 12.35, importValue: 100.01 });
    expect(networkDoc.importAggregates.UK).toBeUndefined();
  });

  it("writes no freight billing fields unless the flag asks for them", () => {
    const result = baseResult({
      freightChargesByDestState: new Map([["A1", new Map([["coal" as CommodityType, 400]])]]),
      haulRevenueByOriginState: new Map([["A2", 400]]),
    });
    const { networkDoc } = buildSourcingDocs(result, 10, new Date());
    expect(networkDoc.freightCharges).toBeUndefined();
    expect(networkDoc.freightHaulRevenue).toBeUndefined();
  });

  it("persists freight billing aggregates rounded to 2 decimals when included", () => {
    const result = baseResult({
      freightChargesByDestState: new Map([
        [
          "A1",
          new Map([
            ["coal" as CommodityType, 400.005],
            ["oil" as CommodityType, 0], // zero -> omitted
          ]),
        ],
        ["A3", new Map([["oil" as CommodityType, 0]])], // empty after omit -> state dropped
      ]),
      haulRevenueByOriginState: new Map([
        ["A2", 400.005],
        ["A4", 0],
      ]),
    });
    const { networkDoc } = buildSourcingDocs(result, 10, new Date(), {
      includeFreightBilling: true,
    });
    expect(networkDoc.freightCharges).toEqual({ A1: { coal: 400.01 } });
    expect(networkDoc.freightHaulRevenue).toEqual({ A2: 400.01 });
  });

  it("scales billing charge and haul revenue by the ramp fraction, conserving both sides", () => {
    const result = baseResult({
      freightChargesByDestState: new Map([["A1", new Map([["coal" as CommodityType, 400]])]]),
      haulRevenueByOriginState: new Map([["A2", 400]]),
    });
    const { networkDoc } = buildSourcingDocs(result, 10, new Date(), {
      includeFreightBilling: true,
      billingRampFraction: 0.25,
    });
    // Both sides scaled by the same 0.25, so the charge/credit totals still match.
    expect(networkDoc.freightCharges).toEqual({ A1: { coal: 100 } });
    expect(networkDoc.freightHaulRevenue).toEqual({ A2: 100 });
  });

  it("at ramp fraction 0 writes no billing (fully phased out)", () => {
    const result = baseResult({
      freightChargesByDestState: new Map([["A1", new Map([["coal" as CommodityType, 400]])]]),
      haulRevenueByOriginState: new Map([["A2", 400]]),
    });
    const { networkDoc } = buildSourcingDocs(result, 10, new Date(), {
      includeFreightBilling: true,
      billingRampFraction: 0,
    });
    // 400 * 0 rounds to 0 -> omitted on both sides.
    expect(networkDoc.freightCharges).toEqual({});
    expect(networkDoc.freightHaulRevenue).toEqual({});
  });
});
