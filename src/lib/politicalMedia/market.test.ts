import { describe, expect, it } from "vitest";
import type { SectorClearingInput, SectorClearingResult } from "@/lib/market/clearing";
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
      turn: 12,
    });
    const disabled = settlePoliticalAdMarket({
      orders: [{ ...targetOrders[0]!, stateId: "CA" }],
      offers: [offer],
      clearingBySectorId,
      clearingEnabled: false,
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
});
