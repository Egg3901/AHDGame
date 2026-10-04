import { describe, expect, it } from "vitest";
import {
  computeClearingFactors,
  type SectorClearingInput,
  type SectorClearingResult,
} from "@/lib/market/clearing";
import type { CommodityType } from "@/lib/constants/commodities";
import { costPlusPriceFactor } from "@/lib/market/costPlusPricing/rules";
import { TURNS_PER_DAY } from "@/lib/constants/corporations";
import { settlePoliticalAdMarket, type PoliticalAdClearingOffer } from "./market";
import { mediaAudienceAccessLimitUnitsByOutlet } from "@/lib/mediaRegulation/rules";

const input: SectorClearingInput = {
  sectorId: "sector-1",
  revenue: 100,
  supplyRates: { advertising: 0.5, entertainment_services: 0.5 },
  posture: 0,
};

const clearing: SectorClearingResult = {
  factor: 0.5,
  soldFraction: 0.5,
  soldByCommodity: { advertising: 0.5, entertainment_services: 0.5 },
  effectivePosture: 0,
};

const offer: PoliticalAdClearingOffer = {
  input,
  clearing,
  corporationId: "corp-1",
  countryId: "US",
  stateId: "CA",
  basePrice: 240,
  priceRatio: 1,
  sellerCurrencyCode: "EUR",
  sellerLocalPerAnchor: 1.25,
  offeredUnits: 20,
};

describe("settlePoliticalAdMarket", () => {
  it("keeps commercial and funded political delivery inside one grown owner's prior audience budget", () => {
    const accessLimit = mediaAudienceAccessLimitUnitsByOutlet(
      [
        {
          stateId: "CA",
          countryId: "US",
          corporationId: "network-a",
          deliveredAdvertisingUnits: 80,
        },
        {
          stateId: "CA",
          countryId: "US",
          corporationId: "network-b",
          deliveredAdvertisingUnits: 20,
        },
      ],
      0
    ).get("CA:network-a");
    expect(accessLimit).toBe(35);

    const currentUnits = [200, 100];
    const commonAvailability =
      (accessLimit ?? 0) / currentUnits.reduce((sum, units) => sum + units, 0);
    const mediaInputs: SectorClearingInput[] = currentUnits.map((units, index) => ({
      sectorId: `grown-outlet-${index}`,
      revenue: 100,
      supplyRates: { advertising: 1 },
      outputUnitsByCommodity: { advertising: units },
      posture: 0,
      editorialAdvertisingAvailability: commonAvailability,
    }));
    const commercialClearing = computeClearingFactors({
      sectors: mediaInputs,
      balances: new Map([["advertising", { supply: 1_000, demand: 100 }]]),
      priceRatioByCommodity: new Map([["advertising", 1]]),
      basePrices: { advertising: 240 } as Record<CommodityType, number>,
    });
    const commercialUnits = mediaInputs.reduce(
      (sum, mediaInput) =>
        sum +
        currentUnits[Number(mediaInput.sectorId.slice(-1))]! *
          (commercialClearing.get(mediaInput.sectorId)?.soldByCommodity?.advertising ?? 0),
      0
    );
    const political = settlePoliticalAdMarket({
      orders: [
        {
          orderId: "funded-order",
          countryId: "US",
          stateId: "CA",
          createdTurn: 12,
          budgetAnchor: 10_000,
        },
      ],
      offers: mediaInputs.map((mediaInput, index) => ({
        ...offer,
        input: mediaInput,
        clearing: commercialClearing.get(mediaInput.sectorId),
        corporationId: "network-a",
        basePrice: 240,
        offeredUnits: currentUnits[index]!,
      })),
      clearingBySectorId: commercialClearing,
      clearingEnabled: true,
      qualityPremiumEnabled: false,
      turn: 12,
    });
    const politicalUnits = political.allocations[0]?.deliveredUnits ?? 0;

    expect(commercialUnits).toBeGreaterThan(0);
    expect(politicalUnits).toBeGreaterThan(0);
    expect(commercialUnits + politicalUnits).toBeCloseTo(accessLimit ?? 0);
    expect(commercialUnits + politicalUnits).toBeLessThanOrEqual(accessLimit ?? 0);
  });

  it("caps commercial plus funded political fills at editorially available output", () => {
    const mediaInput: SectorClearingInput = {
      sectorId: "sector-1",
      revenue: 100,
      supplyRates: { advertising: 1 },
      posture: 0,
      editorialAdvertisingAvailability: 0.75,
    };
    const realClearing = computeClearingFactors({
      sectors: [mediaInput],
      balances: new Map([["advertising", { supply: 200, demand: 100 }]]),
      priceRatioByCommodity: new Map([["advertising", 1]]),
      basePrices: { advertising: 240 } as Record<CommodityType, number>,
    });
    const commercialSold = realClearing.get("sector-1")!.soldByCommodity!.advertising! * 100;
    const result = settlePoliticalAdMarket({
      orders: [
        {
          orderId: "strong-funded-order",
          countryId: "US",
          stateId: "CA",
          createdTurn: 12,
          budgetAnchor: 10_000,
        },
      ],
      offers: [
        {
          ...offer,
          input: mediaInput,
          clearing: realClearing.get("sector-1"),
          basePrice: 240,
          offeredUnits: 100,
        },
      ],
      clearingBySectorId: realClearing,
      clearingEnabled: true,
      qualityPremiumEnabled: false,
      turn: 12,
    });
    const politicalSold = result.allocations[0]?.deliveredUnits ?? 0;
    const totalSold = commercialSold + politicalSold;

    expect(commercialSold).toBeCloseTo(37.5);
    expect(politicalSold).toBeCloseTo(37.5);
    expect(totalSold).toBeCloseTo(75);
    expect(totalSold).toBeLessThanOrEqual(100 * mediaInput.editorialAdvertisingAvailability!);
    expect(result.clearingBySectorId.get("sector-1")?.soldByCommodity?.advertising).toBeCloseTo(
      0.75
    );
  });

  it("sells only commercial residuals and updates the sector factor and paid local value", () => {
    const result = settlePoliticalAdMarket({
      orders: [
        {
          orderId: "order-1",
          countryId: "US",
          stateId: "CA",
          createdTurn: 12,
          budgetAnchor: 100,
        },
      ],
      offers: [offer],
      clearingBySectorId: new Map([["sector-1", clearing]]),
      clearingEnabled: true,
      qualityPremiumEnabled: true,
      turn: 12,
    });

    expect(result.allocations[0]).toMatchObject({
      deliveredAnchor: 100,
      unfilledAnchor: 0,
      deliveredUnits: 10,
    });
    expect(result.clearingBySectorId.get("sector-1")).toMatchObject({
      factor: 0.75,
      soldFraction: 0.75,
      soldByCommodity: { advertising: 1, entertainment_services: 0.5 },
    });
    expect(result.sellerPayoutLocalByCorpId.get("corp-1")).toBe(125);
  });

  it("keeps political fills in the target state and leaves clearing unchanged when disabled", () => {
    const targetOrders = [
      {
        orderId: "order-1",
        countryId: "US",
        stateId: "NY",
        createdTurn: 12,
        budgetAnchor: 100,
      },
    ];
    const clearingBySectorId = new Map([["sector-1", clearing]]);

    const noLocalSupply = settlePoliticalAdMarket({
      orders: targetOrders,
      offers: [offer],
      clearingBySectorId,
      clearingEnabled: true,
      qualityPremiumEnabled: true,
      turn: 12,
    });
    const disabled = settlePoliticalAdMarket({
      orders: [{ ...targetOrders[0]!, stateId: "CA" }],
      offers: [offer],
      clearingBySectorId,
      clearingEnabled: false,
      qualityPremiumEnabled: true,
      turn: 12,
    });

    expect(noLocalSupply.allocations[0]?.unfilledAnchor).toBe(100);
    expect(disabled.allocations).toEqual([]);
    expect(disabled.clearingBySectorId.get("sector-1")).toEqual(clearing);
    expect(disabled.sellerPayoutLocalByCorpId.size).toBe(0);
  });

  it("reapplies a frozen paid allocation after a clearing retry without requoting cash", () => {
    const changedOffer = {
      ...offer,
      priceRatio: 2,
      sellerLocalPerAnchor: 9,
    };
    const result = settlePoliticalAdMarket({
      orders: [],
      persistedPlans: [
        {
          orderId: "order-1",
          plan: {
            plannedTurn: 12,
            deliveredAnchor: 100,
            unfilledAnchor: 0,
            deliveredUnits: 10,
            sellers: [
              {
                allocationId: "sector-1",
                sectorId: "sector-1",
                corporationId: "corp-1",
                units: 10,
                amountAnchor: 100,
                sellerLocalAmount: 125,
                sellerCurrencyCode: "EUR",
                sellerLocalPerAnchor: 1.25,
              },
            ],
          },
        },
      ],
      offers: [changedOffer],
      clearingBySectorId: new Map([["sector-1", clearing]]),
      clearingEnabled: true,
      qualityPremiumEnabled: true,
      turn: 12,
    });

    expect(result.allocations).toEqual([]);
    expect(result.clearingBySectorId.get("sector-1")).toMatchObject({
      factor: 0.75,
      soldFraction: 0.75,
      soldByCommodity: { advertising: 1, entertainment_services: 0.5 },
    });
    expect(result.sellerPayoutLocalByCorpId.get("corp-1")).toBe(125);
  });

  it("uses the exact per-commodity quote from real cost-plus clearing", () => {
    const costPlusInput: SectorClearingInput = {
      ...input,
      revenue: 2_400,
      supplyRates: { advertising: 1 },
      inputCostIndex: 1.2,
      inputCostShare: 0.8,
      fixedCostShare: 0.2,
      outputQuality: 100,
      posture: 0.1,
    };
    const realClearing = computeClearingFactors({
      sectors: [costPlusInput],
      balances: new Map([["advertising", { supply: 10, demand: 5 }]]),
      priceRatioByCommodity: new Map([["advertising", 1.5]]),
      basePrices: { advertising: 240 } as Record<CommodityType, number>,
    });
    const realResult = realClearing.get("sector-1")!;
    const expectedOfferFactor = costPlusPriceFactor(1.2, 0.1, 0.8, 0.2);
    const expected = (240 * expectedOfferFactor) / TURNS_PER_DAY;
    const pricedOffer = {
      ...offer,
      input: costPlusInput,
      clearing: realResult,
      basePrice: 240,
      offeredUnits: 10,
    };
    const result = settlePoliticalAdMarket({
      orders: [
        {
          orderId: "cost-plus",
          countryId: "US",
          stateId: "CA",
          createdTurn: 12,
          budgetAnchor: 100,
        },
      ],
      offers: [pricedOffer],
      clearingBySectorId: realClearing,
      clearingEnabled: true,
      qualityPremiumEnabled: false,
      turn: 12,
    });

    expect(realResult.effectivePosture).not.toBeCloseTo(0.1, 4);
    expect(realResult.offerFactorByCommodity?.advertising).toBeCloseTo(expectedOfferFactor, 10);
    expect(result.allocations[0]?.deliveredUnits).toBeCloseTo(5, 10);
    expect(result.allocations[0]?.sellers[0]?.amountAnchor).toBeCloseTo(expected * 5, 10);
  });
});

describe("political residual delivery under an ownership law", () => {
  it("shares the owner allowance across outlets and refunds the excluded budget", () => {
    const offers = [
      {
        ...offer,
        input: { ...input, sectorId: "a1", supplyRates: { advertising: 1 } },
        corporationId: "a",
        sellerCurrencyCode: "USD",
        sellerLocalPerAnchor: 1,
        offeredUnits: 100,
        clearing: { ...clearing, soldByCommodity: { advertising: 0.1 } },
      },
      {
        ...offer,
        input: { ...input, sectorId: "a2", supplyRates: { advertising: 1 } },
        corporationId: "a",
        sellerCurrencyCode: "USD",
        sellerLocalPerAnchor: 1,
        offeredUnits: 100,
        clearing: { ...clearing, soldByCommodity: { advertising: 0.1 } },
      },
      {
        ...offer,
        input: { ...input, sectorId: "b", supplyRates: { advertising: 1 } },
        corporationId: "b",
        sellerCurrencyCode: "USD",
        sellerLocalPerAnchor: 1,
        offeredUnits: 80,
        clearing: { ...clearing, soldByCommodity: { advertising: 1 } },
      },
    ];
    const result = settlePoliticalAdMarket({
      orders: [
        { orderId: "order", countryId: "US", stateId: "CA", createdTurn: 1, budgetAnchor: 10000 },
      ],
      offers,
      clearingBySectorId: new Map(offers.map((row) => [row.input.sectorId, row.clearing])),
      clearingEnabled: true,
      qualityPremiumEnabled: false,
      turn: 1,
      mediaOwnership: {
        shareCap: 0.65,
        stateBySector: new Map([
          ["a1", "CA"],
          ["a2", "CA"],
          ["b", "CA"],
        ]),
        corporationBySector: new Map([
          ["a1", "a"],
          ["a2", "a"],
          ["b", "b"],
        ]),
      },
    });
    const allocation = result.allocations[0]!;
    expect(allocation.deliveredUnits).toBeCloseTo(45 / 0.35);
    expect(
      (20 + allocation.deliveredUnits) / (100 + allocation.deliveredUnits)
    ).toBeLessThanOrEqual(0.65 + 1e-12);
    expect(allocation.deliveredAnchor + allocation.unfilledAnchor).toBe(10000);
    expect([...result.sellerPayoutLocalByCorpId.values()].reduce((a, b) => a + b, 0)).toBeCloseTo(
      allocation.deliveredAnchor
    );
    expect(result.clearingBySectorId.get("b")!.soldByCommodity!.advertising).toBe(1);
  });
});
