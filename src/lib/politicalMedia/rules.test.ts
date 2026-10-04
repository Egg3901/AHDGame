import { describe, expect, it } from "vitest";
import {
  allocatePoliticalAdOrders,
  type PoliticalAdOrderDemand,
  type PoliticalAdSellerOffer,
} from "./rules";

const order = (overrides: Partial<PoliticalAdOrderDemand> = {}): PoliticalAdOrderDemand => ({
  orderId: "order-1",
  countryId: "US",
  stateId: "CA",
  createdTurn: 12,
  budgetAnchor: 100,
  ...overrides,
});

const seller = (overrides: Partial<PoliticalAdSellerOffer> = {}): PoliticalAdSellerOffer => ({
  sectorId: "sector-1",
  corporationId: "corp-1",
  countryId: "US",
  stateId: "CA",
  unsoldUnits: 10,
  offeredUnits: 20,
  unitPriceAnchor: 10,
  sellerLocalPerAnchor: 1.25,
  ...overrides,
});

describe("allocatePoliticalAdOrders", () => {
  it("matches only unsold output in the requested state and conserves the order budget", () => {
    const result = allocatePoliticalAdOrders(
      [order()],
      [
        seller(),
        seller({ sectorId: "sector-commercially-sold", unsoldUnits: 0 }),
        seller({ sectorId: "sector-other-state", stateId: "NY" }),
        seller({ sectorId: "sector-other-country", countryId: "CA" }),
      ]
    )[0];

    expect(result.deliveredAnchor).toBe(100);
    expect(result.unfilledAnchor).toBe(0);
    expect(result.deliveredUnits).toBe(10);
    expect(result.sellers).toEqual([
      expect.objectContaining({
        sectorId: "sector-1",
        amountAnchor: 100,
        sellerLocalAmount: 125,
        soldFractionAfterAllocation: 1,
      }),
    ]);
  });

  it("partially fills and leaves the exact unspent amount for refund", () => {
    const result = allocatePoliticalAdOrders([order()], [seller({ unsoldUnits: 3 })])[0];

    expect(result.deliveredAnchor).toBe(30);
    expect(result.unfilledAnchor).toBe(70);
    expect(result.deliveredUnits).toBe(3);
    expect(result.sellers[0]?.soldFractionAfterAllocation).toBe(1);
  });

  it("returns an unfilled order when the target state has no available ad units", () => {
    const result = allocatePoliticalAdOrders(
      [order()],
      [seller({ stateId: "NY" }), seller({ unsoldUnits: 0 })]
    )[0];

    expect(result).toMatchObject({ deliveredAnchor: 0, unfilledAnchor: 100, deliveredUnits: 0 });
    expect(result.sellers).toEqual([]);
  });

  it("orders seller fills by price with stable tie breakers and orders by turn then id", () => {
    const results = allocatePoliticalAdOrders(
      [
        order({ orderId: "later", createdTurn: 13, budgetAnchor: 20 }),
        order({ orderId: "earlier", budgetAnchor: 20 }),
      ],
      [
        seller({
          sectorId: "z-sector",
          corporationId: "z-corp",
          unitPriceAnchor: 5,
          unsoldUnits: 4,
        }),
        seller({
          sectorId: "b-sector",
          corporationId: "b-corp",
          unitPriceAnchor: 5,
          unsoldUnits: 4,
        }),
        seller({
          sectorId: "cheap-sector",
          corporationId: "a-corp",
          unitPriceAnchor: 2,
          unsoldUnits: 2,
        }),
      ]
    );

    expect(results.map((result) => result.orderId)).toEqual(["earlier", "later"]);
    expect(results[0]?.sellers.map((allocation) => allocation.sectorId)).toEqual([
      "cheap-sector",
      "b-sector",
    ]);
    expect(results[1]?.sellers.map((allocation) => allocation.sectorId)).toEqual([
      "b-sector",
      "z-sector",
    ]);
  });
});
