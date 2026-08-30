import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

describe("public forex queries", () => {
  let db: MockDb;

  beforeEach(() => {
    db = createMockDb();
    db.collection("exchangeRates");
  });

  it("returns current rates without heavy history on the collection route", async () => {
    db.collectionMocks.exchangeRates!.find.mockReturnValue({
      sort: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([
        {
          countryId: "UK",
          currencyCode: "GBP",
          rate: 1.25,
          baseRate: 1,
          macroTarget: 1.2,
          buyVolume24: 10,
          sellVolume24: 4,
          rateHistory: [{ turn: 1, rate: 1 }],
          updatedAt: new Date("2026-01-01T00:00:00Z"),
        },
      ]),
    } as never);

    const { queryForexRates } = await import("./forex");
    const result = await queryForexRates(db as unknown as Db);

    expect(result.currencies[0]).toMatchObject({
      currencyCode: "GBP",
      changeFromBasePct: 25,
      volume24: { buy: 10, sell: 4, net: 6 },
    });
    expect(result.currencies[0]).not.toHaveProperty("history");
  });

  it("bounds detail history to the requested trailing window", async () => {
    db.collectionMocks.exchangeRates!.findOne.mockResolvedValue({
      countryId: "US",
      currencyCode: "USD",
      rate: 1,
      baseRate: 1,
      macroTarget: 1,
      buyVolume24: 0,
      sellVolume24: 0,
      rateHistory: [
        { turn: 1, rate: 0.9 },
        { turn: 2, rate: 1 },
      ],
      updatedAt: new Date(),
    });

    const { queryForexCurrency } = await import("./forex");
    const result = await queryForexCurrency(db as unknown as Db, "USD", 1);

    expect(result?.history).toEqual([{ turn: 2, rate: 1 }]);
  });
});
