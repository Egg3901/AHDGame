import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import type { Db } from "mongodb";
import { computeCurrencyVolumes } from "./volumeTracker";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

let db: MockDb;
beforeEach(() => {
  db = createMockDb();
  // Pre-initialize the tradeHistory collection mock so tests can configure it
  db.collection("tradeHistory");
});

describe("computeCurrencyVolumes", () => {
  it("returns zero volumes when no trades exist", async () => {
    const result = await computeCurrencyVolumes(db as unknown as Db, 50);
    expect(result.USD).toEqual({ buyVolume24: 0, sellVolume24: 0 });
    expect(result.GBP).toEqual({ buyVolume24: 0, sellVolume24: 0 });
    expect(result.JPY).toEqual({ buyVolume24: 0, sellVolume24: 0 });
  });

  it("queries tradeHistory with correct turn range", async () => {
    await computeCurrencyVolumes(db as unknown as Db, 50);

    const tradeHistoryMock = db.collectionMocks.tradeHistory;
    expect(tradeHistoryMock.find).toHaveBeenCalledWith({ turn: { $gte: 26 } }); // 50 - 24
  });

  it("clamps lookback start to 1 when current turn is low", async () => {
    await computeCurrencyVolumes(db as unknown as Db, 10);

    const tradeHistoryMock = db.collectionMocks.tradeHistory;
    // 10 - 24 = -14, clamped to 1
    expect(tradeHistoryMock.find).toHaveBeenCalledWith({ turn: { $gte: 1 } });
  });

  it("accumulates sell volume for fromCurrency and buy volume for toCurrency", async () => {
    const tradeHistoryMock = db.collectionMocks.tradeHistory;

    // Override find to return trades
    tradeHistoryMock.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        { fromCurrency: "USD", toCurrency: "JPY", amount: 500, rate: 106, turn: 48 },
        { fromCurrency: "USD", toCurrency: "JPY", amount: 300, rate: 105, turn: 49 },
        { fromCurrency: "JPY", toCurrency: "USD", amount: 200, rate: 106, turn: 49 },
      ]),
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      project: vi.fn().mockReturnThis(),
    });

    const result = await computeCurrencyVolumes(db as unknown as Db, 50);

    // USD: sold 500 + 300 = 800, bought 200
    expect(result.USD.sellVolume24).toBe(800);
    expect(result.USD.buyVolume24).toBe(200);

    // JPY: bought 500 + 300 = 800, sold 200
    expect(result.JPY.buyVolume24).toBe(800);
    expect(result.JPY.sellVolume24).toBe(200);
  });

  it("handles GBP trades correctly", async () => {
    const tradeHistoryMock = db.collectionMocks.tradeHistory;
    tradeHistoryMock.find.mockReturnValue({
      toArray: vi
        .fn()
        .mockResolvedValue([
          { fromCurrency: "GBP", toCurrency: "USD", amount: 1000, rate: 1.0, turn: 40 },
        ]),
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      project: vi.fn().mockReturnThis(),
    });

    const result = await computeCurrencyVolumes(db as unknown as Db, 50);
    expect(result.GBP.sellVolume24).toBe(1000);
    expect(result.USD.buyVolume24).toBe(1000);
  });

  it("ignores trades involving non-forex currencies", async () => {
    const tradeHistoryMock = db.collectionMocks.tradeHistory;
    tradeHistoryMock.find.mockReturnValue({
      toArray: vi
        .fn()
        .mockResolvedValue([
          { fromCurrency: "CAD", toCurrency: "USD", amount: 500, rate: 1.0, turn: 48 },
        ]),
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      project: vi.fn().mockReturnThis(),
    });

    const result = await computeCurrencyVolumes(db as unknown as Db, 50);
    // CAD is not in volumes map, USD gets the buy
    expect(result.USD.buyVolume24).toBe(500);
    // CAD should not be in the result (only active currencies)
    expect((result as Record<string, unknown>).CAD).toBeUndefined();
  });
});
