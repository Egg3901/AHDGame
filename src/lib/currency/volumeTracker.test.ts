import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import type { Db } from "mongodb";
import { planEuroSettlement } from "./euro/rules";
import { computeCurrencyVolumes, effectiveTraderCount } from "./volumeTracker";

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

it("consolidates post-accession external trades and excludes internal euro conversions", async () => {
  const union = planEuroSettlement({
    year: 1999,
    turn: 385,
    preset: "1991-default",
    europeanMembers: ["DE", "IE", "UK"],
    consentedCountries: ["DE", "IE", "UK"],
    rates: { EUR: 0.8, IEP: 0.7, GBP: 0.6 },
  }).union;
  db.collection("tradeHistory").find.mockReturnValue({
    toArray: vi.fn().mockResolvedValue([
      { fromCurrency: "GBP", toCurrency: "EUR", amount: 600, turn: 386 },
      { fromCurrency: "GBP", toCurrency: "USD", amount: 600, turn: 386 },
      { fromCurrency: "GBP", toCurrency: "USD", amount: 300, turn: 384 },
    ]),
  });
  db.collection("exchangeRates").find.mockReturnValue({
    toArray: vi.fn().mockResolvedValue([
      { currencyCode: "GBP", rate: 0.6 },
      { currencyCode: "EUR", rate: 0.8 },
    ]),
  });
  const result = await computeCurrencyVolumes(db as unknown as Db, 387, union);
  // One (system) trader behind every flow, so each reads as a single trader.
  expect(result.EUR).toEqual({ buyVolume24: 0, sellVolume24: 1000, effectiveTraders: 1 });
  expect(result.GBP).toEqual({ buyVolume24: 0, sellVolume24: 500, effectiveTraders: 1 });
  expect(result.USD).toEqual({ buyVolume24: 1500, sellVolume24: 0, effectiveTraders: 1 });
});

describe("effectiveTraderCount", () => {
  it("is null when the net flow is zero", () => {
    expect(effectiveTraderCount([])).toBeNull();
    expect(effectiveTraderCount([100, -100])).toBeNull();
  });

  it("counts equal contributors in the net direction", () => {
    expect(effectiveTraderCount([10, 10, 10, 10])).toBeCloseTo(4, 10);
  });

  it("reads one holder with crumbs alongside as about one trader", () => {
    const n = effectiveTraderCount([400_000_000_000, 1_000, 2_000, 500]);
    expect(n).toBeGreaterThan(1);
    expect(n).toBeLessThan(1.001);
  });

  it("ignores contributions against the net direction", () => {
    expect(effectiveTraderCount([10, 10, -5])).toBeCloseTo(2, 10);
  });
});

it("tracks breadth per trader, so one large buyer reads as one trader", async () => {
  const whale = "aaaaaaaaaaaaaaaaaaaaaaaa";
  db.collection("tradeHistory").find.mockReturnValue({
    toArray: vi.fn().mockResolvedValue([
      { buyerCharacterId: whale, fromCurrency: "USD", toCurrency: "GBP", amount: 1e9, turn: 10 },
      { buyerCharacterId: "b1", fromCurrency: "USD", toCurrency: "GBP", amount: 10, turn: 10 },
      { buyerCharacterId: "b2", fromCurrency: "USD", toCurrency: "GBP", amount: 10, turn: 10 },
    ]),
  });
  db.collection("exchangeRates").find.mockReturnValue({
    toArray: vi.fn().mockResolvedValue([
      { currencyCode: "USD", rate: 1 },
      { currencyCode: "GBP", rate: 0.5 },
    ]),
  });
  const result = await computeCurrencyVolumes(db as unknown as Db, 12);
  expect(result.GBP.effectiveTraders).toBeGreaterThan(1);
  expect(result.GBP.effectiveTraders).toBeLessThan(1.0001);
});
