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
