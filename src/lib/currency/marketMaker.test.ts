// src/lib/currency/marketMaker.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import { getCountryForCurrency, distributeConversionSpread } from "./marketMaker";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

describe("distributeConversionSpread", () => {
  let db: MockDb;
  beforeEach(() => {
    db = createMockDb();
    (db as unknown as Db).collection("centralBanks");
    db.collectionMocks.centralBanks.updateOne.mockResolvedValue({ modifiedCount: 1 });
  });

  it("routes a corp/fund conversion spread to source + destination CBs (50/25/25)", async () => {
    // GBP→USD conversion, fee 100 GBP: forexRevenue 25 → UK; reserve 50 GBP → US.
    await distributeConversionSpread(db as unknown as Db, 100, "GBP", "USD");
    const calls = db.collectionMocks.centralBanks.updateOne.mock.calls;
    expect(calls).toContainEqual([{ _id: "UK" }, { $inc: { forexRevenue: 25 } }, { upsert: true }]);
    expect(calls).toContainEqual([
      { _id: "US" },
      { $inc: { "spreadFeeReserveBalances.GBP": 50 } },
      { upsert: true },
    ]);
  });

  it("no-ops on a non-positive fee, same-currency, or unknown source currency", async () => {
    await distributeConversionSpread(db as unknown as Db, 0, "GBP", "USD");
    await distributeConversionSpread(db as unknown as Db, 100, "USD", "USD");
    await distributeConversionSpread(db as unknown as Db, 100, "CAD", "USD"); // CAD has no CB
    expect(db.collectionMocks.centralBanks.updateOne).not.toHaveBeenCalled();
  });
});

describe("getCountryForCurrency", () => {
  it("resolves EUR to its anchor DE (never IE, which has no rate doc)", () => {
    expect(getCountryForCurrency("EUR")).toBe("DE");
  });

  it("resolves single-country currencies to themselves", () => {
    expect(getCountryForCurrency("USD")).toBe("US");
    expect(getCountryForCurrency("JPY")).toBe("JP");
    expect(getCountryForCurrency("CNY")).toBe("CN");
  });

  it("returns null for a currency no country uses (CAD), keeping the trade guard", () => {
    // CAD only has a USD-parity fallback in the anchor map; no country's home
    // currency is CAD, so a CAD trade must still be rejected as invalid.
    expect(getCountryForCurrency("CAD")).toBeNull();
  });
});

let db: MockDb;

beforeEach(async () => {
  vi.resetModules();
  db = createMockDb();
  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
});

describe("executeMarketMakerTrade", () => {
  const characterId = new ObjectId();
  const buyerCountryId = "US" as const;

  it("executes a USD->JPY trade: deducts USD, credits JPY, records history", async () => {
    // Setup: USD rate = 1.0, JPY rate = 106.0
    // Cross rate USD/JPY = 106.0 / 1.0 = 106.0
    // Buying JPY with 1000 USD: spread = 1000 * 0.00275 = 2.75
    // Net amount after spread: 1000 - 2.75 = 997.25
    // JPY received: 997.25 * 106.0 = 105,708.5
    const typedDb = db as unknown as Db;
    typedDb.collection("exchangeRates");
    typedDb.collection("characters");
    typedDb.collection("tradeHistory");
    typedDb.collection("centralBanks");

    db.collectionMocks.characters.findOne.mockResolvedValue({
      currencyBalances: { personal: { USD: 1_000_000 } },
    });
    db.collectionMocks.exchangeRates.findOne
      .mockResolvedValueOnce({ _id: "US", countryId: "US", currencyCode: "USD", rate: 1.0 })
      .mockResolvedValueOnce({ _id: "JP", countryId: "JP", currencyCode: "JPY", rate: 106.0 });
    db.collectionMocks.characters.updateOne.mockResolvedValue({ modifiedCount: 1 });
    db.collectionMocks.tradeHistory.insertOne.mockResolvedValue({ insertedId: new ObjectId() });
    db.collectionMocks.centralBanks.updateOne.mockResolvedValue({ modifiedCount: 1 });

    const { executeMarketMakerTrade } = await import("./marketMaker");
    const result = await executeMarketMakerTrade(typedDb, {
      characterId,
      countryId: buyerCountryId,
      fromCurrency: "USD",
      toCurrency: "JPY",
      amount: 1000,
      turn: 100,
    });

    expect(result.success).toBe(true);
    expect(result.fromAmount).toBe(1000);
    // Spread: Math.round(1000 * 0.01) = 10
    expect(result.spreadCharged).toBe(10);
    // Net: 1000 - 10 = 990, toAmount: Math.round(990 * 106.0) = 104940
    expect(result.toAmount).toBe(104940);
    expect(result.effectiveRate).toBeCloseTo(106.0);

    // Verify character balance updates were called
    expect(db.collectionMocks.characters.updateOne).toHaveBeenCalled();
    // Verify trade history was recorded
    expect(db.collectionMocks.tradeHistory.insertOne).toHaveBeenCalled();
  });

  it("scales the spread by the source currency chair's forexSpreadStrength", async () => {
    const typedDb = db as unknown as Db;
    typedDb.collection("exchangeRates");
    typedDb.collection("characters");
    typedDb.collection("tradeHistory");
    typedDb.collection("centralBanks");
    db.collectionMocks.exchangeRates.updateOne.mockResolvedValue({ modifiedCount: 1 });
    db.collectionMocks.centralBanks.updateOne.mockResolvedValue({ modifiedCount: 1 });
    db.collectionMocks.characters.findOne.mockResolvedValue({
      currencyBalances: { personal: { USD: 5000 } },
    });
    db.collectionMocks.characters.updateOne.mockResolvedValue({ modifiedCount: 1 });
    // US chair set spread strength to 1.5× → fee = round(1000 × 0.01 × 1.5) = 15.
    db.collectionMocks.exchangeRates.findOne
      .mockResolvedValueOnce({
        _id: "US",
        countryId: "US",
        currencyCode: "USD",
        rate: 1.0,
        forexSpreadStrength: 1.5,
      })
      .mockResolvedValueOnce({ _id: "JP", countryId: "JP", currencyCode: "JPY", rate: 106.0 });

    const { executeMarketMakerTrade } = await import("./marketMaker");
    const result = await executeMarketMakerTrade(typedDb, {
      characterId: new ObjectId(),
      countryId: "US",
      fromCurrency: "USD",
      toCurrency: "JPY",
      amount: 1000,
      turn: 100,
    });

    expect(result.success).toBe(true);
    expect(result.spreadCharged).toBe(15); // 1.5× the base 10
  });

  it("returns failure when source exchange rate not found", async () => {
    const typedDb = db as unknown as Db;
    typedDb.collection("exchangeRates");
    typedDb.collection("characters");

    db.collectionMocks.characters.findOne.mockResolvedValue({
      currencyBalances: { personal: { USD: 1_000_000 } },
    });
    db.collectionMocks.exchangeRates.findOne.mockResolvedValue(null);

    const { executeMarketMakerTrade } = await import("./marketMaker");
    const result = await executeMarketMakerTrade(typedDb, {
      characterId,
      countryId: buyerCountryId,
      fromCurrency: "USD",
      toCurrency: "JPY",
      amount: 1000,
      turn: 100,
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/exchange rate/i);
  });

  it("returns failure when character has insufficient balance", async () => {
    const typedDb = db as unknown as Db;
    typedDb.collection("exchangeRates");
    typedDb.collection("characters");

    db.collectionMocks.characters.findOne.mockResolvedValue({
      currencyBalances: { personal: { USD: 50 } },
    });
    db.collectionMocks.exchangeRates.findOne
      .mockResolvedValueOnce({ _id: "US", countryId: "US", currencyCode: "USD", rate: 1.0 })
      .mockResolvedValueOnce({ _id: "JP", countryId: "JP", currencyCode: "JPY", rate: 106.0 });

    const { executeMarketMakerTrade } = await import("./marketMaker");
    const result = await executeMarketMakerTrade(typedDb, {
      characterId,
      countryId: buyerCountryId,
      fromCurrency: "USD",
      toCurrency: "JPY",
      amount: 1000,
      turn: 100,
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/insufficient/i);
    expect(db.collectionMocks.characters.updateOne).not.toHaveBeenCalled();
  });

  it("returns failure without writing when fromExRate.rate is missing (regression: bond-maturity drain)", async () => {
    const typedDb = db as unknown as Db;
    typedDb.collection("exchangeRates");
    typedDb.collection("characters");
    typedDb.collection("tradeHistory");

    db.collectionMocks.characters.findOne.mockResolvedValue({
      currencyBalances: { personal: { GBP: 39_551_432 } },
    });
    // fromExRate exists but .rate is undefined (the failure mode observed on
    // turns 270–277 that drained ~$40M from a single player's maturity payout).
    db.collectionMocks.exchangeRates.findOne
      .mockResolvedValueOnce({ _id: "UK", countryId: "UK", currencyCode: "GBP" })
      .mockResolvedValueOnce({ _id: "US", countryId: "US", currencyCode: "USD", rate: 1.0 });

    const { executeMarketMakerTrade } = await import("./marketMaker");
    const result = await executeMarketMakerTrade(typedDb, {
      characterId,
      countryId: buyerCountryId,
      fromCurrency: "GBP",
      toCurrency: "USD",
      amount: 39_551_432,
      turn: 271,
      source: "auto_coupon",
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/invalid/i);
    // Critical: the source balance must NOT have been debited when the rate is unusable.
    expect(db.collectionMocks.characters.updateOne).not.toHaveBeenCalled();
    expect(db.collectionMocks.tradeHistory.insertOne).not.toHaveBeenCalled();
  });

  it("returns failure when fromExRate.rate is NaN", async () => {
    const typedDb = db as unknown as Db;
    typedDb.collection("exchangeRates");
    typedDb.collection("characters");
    typedDb.collection("tradeHistory");

    db.collectionMocks.characters.findOne.mockResolvedValue({
      currencyBalances: { personal: { GBP: 1_000 } },
    });
    db.collectionMocks.exchangeRates.findOne
      .mockResolvedValueOnce({ _id: "UK", countryId: "UK", currencyCode: "GBP", rate: NaN })
      .mockResolvedValueOnce({ _id: "US", countryId: "US", currencyCode: "USD", rate: 1.0 });

    const { executeMarketMakerTrade } = await import("./marketMaker");
    const result = await executeMarketMakerTrade(typedDb, {
      characterId,
      countryId: buyerCountryId,
      fromCurrency: "GBP",
      toCurrency: "USD",
      amount: 1_000,
      turn: 100,
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/invalid/i);
    expect(db.collectionMocks.characters.updateOne).not.toHaveBeenCalled();
  });

  it("returns failure when toExRate.rate is zero or negative", async () => {
    const typedDb = db as unknown as Db;
    typedDb.collection("exchangeRates");
    typedDb.collection("characters");
    typedDb.collection("tradeHistory");

    db.collectionMocks.characters.findOne.mockResolvedValue({
      currencyBalances: { personal: { GBP: 1_000 } },
    });
    db.collectionMocks.exchangeRates.findOne
      .mockResolvedValueOnce({ _id: "UK", countryId: "UK", currencyCode: "GBP", rate: 0.75 })
      .mockResolvedValueOnce({ _id: "US", countryId: "US", currencyCode: "USD", rate: 0 });

    const { executeMarketMakerTrade } = await import("./marketMaker");
    const result = await executeMarketMakerTrade(typedDb, {
      characterId,
      countryId: buyerCountryId,
      fromCurrency: "GBP",
      toCurrency: "USD",
      amount: 1_000,
      turn: 100,
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/invalid/i);
    expect(db.collectionMocks.characters.updateOne).not.toHaveBeenCalled();
  });

  it("uses stored balance when requested amount is slightly above float balance (display 2dp vs IEEE)", async () => {
    const typedDb = db as unknown as Db;
    typedDb.collection("exchangeRates");
    typedDb.collection("characters");
    typedDb.collection("tradeHistory");
    typedDb.collection("centralBanks");

    const stored = 12_002_473.049_999_5;
    const requested = 12_002_473.05;

    db.collectionMocks.characters.findOne.mockResolvedValue({
      currencyBalances: { personal: { GBP: stored } },
    });
    db.collectionMocks.exchangeRates.findOne
      .mockResolvedValueOnce({ _id: "UK", countryId: "UK", currencyCode: "GBP", rate: 0.75 })
      .mockResolvedValueOnce({ _id: "US", countryId: "US", currencyCode: "USD", rate: 1.0 });
    db.collectionMocks.characters.updateOne.mockResolvedValue({ modifiedCount: 1 });
    db.collectionMocks.tradeHistory.insertOne.mockResolvedValue({ insertedId: new ObjectId() });
    db.collectionMocks.centralBanks.updateOne.mockResolvedValue({ modifiedCount: 1 });

    const { executeMarketMakerTrade } = await import("./marketMaker");
    const result = await executeMarketMakerTrade(typedDb, {
      characterId,
      countryId: buyerCountryId,
      fromCurrency: "GBP",
      toCurrency: "USD",
      amount: requested,
      turn: 100,
    });

    expect(result.success).toBe(true);
    expect(result.fromAmount).toBe(stored);

    const updateCall = db.collectionMocks.characters.updateOne.mock.calls[0];
    expect(updateCall[0]).toMatchObject({
      [`currencyBalances.personal.GBP`]: { $gte: stored },
    });
  });
});
