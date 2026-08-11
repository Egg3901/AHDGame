// src/lib/currency/autoConvert.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

let db: MockDb;

beforeEach(async () => {
  vi.resetModules();
  db = createMockDb();
  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
});

/** Initialize collection mocks by accessing them through db.collection() */
function initCollections(...names: string[]) {
  const typedDb = db as unknown as Db;
  for (const name of names) typedDb.collection(name);
}

describe("autoConvertForPurchase", () => {
  const characterId = new ObjectId();

  it("returns no-op when character has sufficient foreign currency", async () => {
    const character = {
      _id: characterId,
      countryId: "US",
      currencyBalances: { campaign: 0, personal: { USD: 5000, JPY: 200000 } },
      autoConvertEnabled: true,
    };

    const { autoConvertForPurchase } = await import("./autoConvert");
    const result = await autoConvertForPurchase(db as unknown as Db, {
      character: character as never,
      requiredCurrency: "JPY",
      requiredAmount: 100000,
      turn: 100,
      forexEnabled: true,
    });

    expect(result.needed).toBe(false);
    expect(result.convertedAmount).toBe(0);
  });

  it("converts shortfall from home currency at market maker rate", async () => {
    initCollections("exchangeRates", "characters", "tradeHistory", "centralBanks");

    const character = {
      _id: characterId,
      countryId: "US",
      currencyBalances: { campaign: 0, personal: { USD: 5000, JPY: 50000 } },
      autoConvertEnabled: true,
    };

    // Stateful balances so consolidation + FX legs see post-trade wallets (matches real DB).
    const balances: Record<string, number> = { USD: 5000, JPY: 50000 };
    db.collectionMocks.characters.findOne.mockImplementation(async () => ({
      currencyBalances: { personal: { ...balances } },
    }));
    // Consolidation + FX may query rates many times — avoid exhausting Once() mocks.
    db.collectionMocks.exchangeRates.findOne.mockImplementation(async ({ _id }: { _id: string }) =>
      _id === "US"
        ? { _id: "US", countryId: "US", currencyCode: "USD", rate: 1.0 }
        : { _id: "JP", countryId: "JP", currencyCode: "JPY", rate: 106.0 }
    );
    db.collectionMocks.characters.updateOne.mockImplementation(async (_f, update) => {
      const inc = (update as { $inc?: Record<string, number> }).$inc;
      if (inc) {
        for (const [k, delta] of Object.entries(inc)) {
          const m = k.match(/^currencyBalances\.personal\.(USD|GBP|JPY)$/);
          if (m && typeof delta === "number") {
            balances[m[1] as string] = (balances[m[1] as string] ?? 0) + delta;
          }
        }
      }
      return { modifiedCount: 1, matchedCount: 1 };
    });
    db.collectionMocks.tradeHistory.insertOne.mockResolvedValue({ insertedId: new ObjectId() });
    db.collectionMocks.centralBanks.updateOne.mockResolvedValue({ modifiedCount: 1 });

    const { autoConvertForPurchase } = await import("./autoConvert");
    const result = await autoConvertForPurchase(db as unknown as Db, {
      character: character as never,
      requiredCurrency: "JPY",
      requiredAmount: 100000,
      turn: 100,
      forexEnabled: true,
    });

    expect(result.needed).toBe(true);
    expect(result.success).toBe(true);
    expect(result.shortfall).toBe(0);
    expect(result.convertedAmount).toBeGreaterThan(0);
  });

  it("returns error when autoConvert is disabled", async () => {
    const character = {
      _id: characterId,
      countryId: "US",
      currencyBalances: { campaign: 0, personal: { USD: 5000, JPY: 0 } },
      autoConvertEnabled: false,
    };

    const { autoConvertForPurchase } = await import("./autoConvert");
    const result = await autoConvertForPurchase(db as unknown as Db, {
      character: character as never,
      requiredCurrency: "JPY",
      requiredAmount: 100000,
      turn: 100,
      forexEnabled: true,
    });

    expect(result.needed).toBe(true);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/auto-convert.*disabled/i);
  });

  it("returns error when home currency balance insufficient for conversion", async () => {
    initCollections("exchangeRates");

    const character = {
      _id: characterId,
      countryId: "US",
      currencyBalances: { campaign: 0, personal: { USD: 10, JPY: 0 } },
      autoConvertEnabled: true,
    };

    db.collectionMocks.exchangeRates.findOne
      .mockResolvedValueOnce({ _id: "US", countryId: "US", currencyCode: "USD", rate: 1.0 })
      .mockResolvedValueOnce({ _id: "JP", countryId: "JP", currencyCode: "JPY", rate: 106.0 });

    const { autoConvertForPurchase } = await import("./autoConvert");
    const result = await autoConvertForPurchase(db as unknown as Db, {
      character: character as never,
      requiredCurrency: "JPY",
      requiredAmount: 100000,
      turn: 100,
      forexEnabled: true,
    });

    expect(result.needed).toBe(true);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/insufficient/i);
  });

  it("treats undefined autoConvertEnabled as enabled (default on)", async () => {
    initCollections("exchangeRates", "characters", "tradeHistory", "centralBanks");

    const character = {
      _id: characterId,
      countryId: "US",
      currencyBalances: { campaign: 0, personal: { USD: 5000, JPY: 0 } },
      // autoConvertEnabled intentionally undefined
    };

    const balances: Record<string, number> = { USD: 5000, JPY: 0 };
    db.collectionMocks.characters.findOne.mockImplementation(async () => ({
      currencyBalances: { personal: { ...balances } },
    }));
    db.collectionMocks.exchangeRates.findOne.mockImplementation(async ({ _id }: { _id: string }) =>
      _id === "US"
        ? { _id: "US", countryId: "US", currencyCode: "USD", rate: 1.0 }
        : { _id: "JP", countryId: "JP", currencyCode: "JPY", rate: 106.0 }
    );
    db.collectionMocks.characters.updateOne.mockImplementation(async (_f, update) => {
      const inc = (update as { $inc?: Record<string, number> }).$inc;
      if (inc) {
        for (const [k, delta] of Object.entries(inc)) {
          const m = k.match(/^currencyBalances\.personal\.(USD|GBP|JPY)$/);
          if (m && typeof delta === "number") {
            balances[m[1] as string] = (balances[m[1] as string] ?? 0) + delta;
          }
        }
      }
      return { modifiedCount: 1, matchedCount: 1 };
    });
    db.collectionMocks.tradeHistory.insertOne.mockResolvedValue({ insertedId: new ObjectId() });
    db.collectionMocks.centralBanks.updateOne.mockResolvedValue({ modifiedCount: 1 });

    const { autoConvertForPurchase } = await import("./autoConvert");
    const result = await autoConvertForPurchase(db as unknown as Db, {
      character: character as never,
      requiredCurrency: "JPY",
      requiredAmount: 100000,
      turn: 100,
      forexEnabled: true,
    });

    // Should attempt conversion (not reject due to disabled flag)
    expect(result.needed).toBe(true);
    expect(result.success).toBe(true);
  });
});

describe("convertForExplicitPay", () => {
  const characterId = new ObjectId();

  it("returns no-op when payCurrency equals requiredCurrency", async () => {
    const character = {
      _id: characterId,
      countryId: "US",
      currencyBalances: { campaign: 0, personal: { USD: 1000 } },
    };

    const { convertForExplicitPay } = await import("./autoConvert");
    const result = await convertForExplicitPay(db as unknown as Db, {
      character: character as never,
      payCurrency: "USD",
      requiredCurrency: "USD",
      requiredAmount: 500,
      turn: 1,
      forexEnabled: true,
    });

    expect(result.needed).toBe(false);
    expect(result.success).toBe(true);
    expect(result.convertedAmount).toBe(0);
  });

  it("returns error when exchange rates are unavailable", async () => {
    initCollections("exchangeRates");
    // findOne returns null by default on uninitialised mock — simulates missing exchange rates

    const character = {
      _id: characterId,
      countryId: "US",
      currencyBalances: { campaign: 0, personal: { USD: 1000, GBP: 0 } },
    };

    const { convertForExplicitPay } = await import("./autoConvert");
    const result = await convertForExplicitPay(db as unknown as Db, {
      character: character as never,
      payCurrency: "USD",
      requiredCurrency: "GBP",
      requiredAmount: 100,
      turn: 1,
      forexEnabled: true,
    });

    expect(result.needed).toBe(true);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/exchange rates not available/i);
  });

  it("returns error when payCurrency balance is insufficient", async () => {
    initCollections("exchangeRates");

    const character = {
      _id: characterId,
      countryId: "US",
      currencyBalances: { campaign: 0, personal: { USD: 10, GBP: 0 } },
    };

    // USD→GBP: cross_rate = 0.75/1.0 = 0.75
    // To get 100 GBP: need 100 / (0.75 * (1-0.00275)) ≈ 133.7 USD
    // Player has only 10 USD → insufficient
    db.collectionMocks.exchangeRates.findOne
      .mockResolvedValueOnce({ _id: "US", countryId: "US", currencyCode: "USD", rate: 1.0 })
      .mockResolvedValueOnce({ _id: "UK", countryId: "UK", currencyCode: "GBP", rate: 0.75 });

    const { convertForExplicitPay } = await import("./autoConvert");
    const result = await convertForExplicitPay(db as unknown as Db, {
      character: character as never,
      payCurrency: "USD",
      requiredCurrency: "GBP",
      requiredAmount: 100,
      turn: 1,
      forexEnabled: true,
    });

    expect(result.needed).toBe(true);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/insufficient/i);
  });

  it("executes conversion when balance is sufficient", async () => {
    initCollections("exchangeRates", "characters", "tradeHistory", "centralBanks");

    const character = {
      _id: characterId,
      countryId: "US",
      currencyBalances: { campaign: 0, personal: { USD: 500, GBP: 0 } },
    };

    db.collectionMocks.characters.findOne.mockResolvedValue({
      currencyBalances: { personal: { USD: 500, GBP: 0 } },
    });
    db.collectionMocks.exchangeRates.findOne
      .mockResolvedValueOnce({ _id: "US", countryId: "US", currencyCode: "USD", rate: 1.0 })
      .mockResolvedValueOnce({ _id: "UK", countryId: "UK", currencyCode: "GBP", rate: 0.75 })
      .mockResolvedValueOnce({ _id: "US", countryId: "US", currencyCode: "USD", rate: 1.0 })
      .mockResolvedValueOnce({ _id: "UK", countryId: "UK", currencyCode: "GBP", rate: 0.75 });
    db.collectionMocks.characters.updateOne.mockResolvedValue({ modifiedCount: 1 });
    db.collectionMocks.tradeHistory.insertOne.mockResolvedValue({ insertedId: new ObjectId() });
    db.collectionMocks.centralBanks.updateOne.mockResolvedValue({ modifiedCount: 1 });

    const { convertForExplicitPay } = await import("./autoConvert");
    const result = await convertForExplicitPay(db as unknown as Db, {
      character: character as never,
      payCurrency: "USD",
      requiredCurrency: "GBP",
      requiredAmount: 100,
      turn: 1,
      forexEnabled: true,
    });

    expect(result.needed).toBe(true);
    expect(result.success).toBe(true);
    expect(result.convertedAmount).toBeGreaterThan(0);
    expect(result.shortfall).toBe(0);
  });
});
