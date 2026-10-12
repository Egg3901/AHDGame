import { describe, expect, it } from "vitest";
import type { CorporateSector } from "@/lib/db/types/corporation";
import { quoteConversionConstructionRefund } from "./constructionRefund";
const order = {
  unitsOrdered: 100,
  costPaidAnchor: 1000,
  startTurn: 10,
  onlineTurn: 20,
  smooth: true,
};
const sector = (overrides: object = {}) =>
  ({
    sectorType: "manufacturing",
    capitalStock: 240,
    capacityBookAnchor: 2400,
    operatingCapacityTurn: 14,
    buildQueue: [order],
    ...overrides,
  }) as CorporateSector;
describe("whole-order conversion construction refunds", () => {
  it("refunds full cost and reverses only delivered investment", () => {
    const quote = quoteConversionConstructionRefund(sector(), 15);
    expect(quote).toMatchObject({
      anchor: 1000,
      units: 100,
      set: {
        capitalStock: 200,
        capacityBookAnchor: 2000,
        buildQueue: [],
        constructionInProgressAnchor: 0,
      },
    });
  });
  it("uses the sector's completed turn rather than advancing delivery", () => {
    expect(
      quoteConversionConstructionRefund(
        sector({ operatingCapacityTurn: 15, capitalStock: 250, capacityBookAnchor: 2500 }),
        15
      ).set.capitalStock
    ).toBe(200);
  });
  it("does not refund or return an unpriced growth credit to the market pool", () => {
    expect(
      quoteConversionConstructionRefund(
        sector({ buildQueue: [{ ...order, costPaidAnchor: 0 }] }),
        15
      )
    ).toMatchObject({ anchor: 0, units: 0, set: { capitalStock: 200, capacityBookAnchor: 2400 } });
  });
  it("is inert once the cancelled queue is gone", () => {
    const first = quoteConversionConstructionRefund(sector(), 15);
    expect(quoteConversionConstructionRefund(sector(first.set), 16)).toMatchObject({
      anchor: 0,
      units: 0,
      set: { capitalStock: 200, capacityBookAnchor: 2000 },
    });
  });
  it.each([NaN, -1, Infinity])("rejects invalid order cost %s", (costPaidAnchor) => {
    expect(() =>
      quoteConversionConstructionRefund(sector({ buildQueue: [{ ...order, costPaidAnchor }] }), 15)
    ).toThrow();
  });
});
