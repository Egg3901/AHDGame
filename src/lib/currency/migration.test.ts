import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { FOREX_ACTIVE_COUNTRIES } from "@/lib/constants/currencies";
import type { Db } from "mongodb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

let db: MockDb;

beforeEach(async () => {
  vi.resetModules();
  db = createMockDb();
  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
});

/** Helper: build a mock async-iterable cursor from an array of docs */
function mockCursor(docs: Record<string, unknown>[]) {
  let index = 0;
  const iter = {
    [Symbol.asyncIterator]: () => ({
      next: async () => {
        if (index >= docs.length) return { done: true as const, value: undefined };
        return { done: false as const, value: docs[index++] };
      },
    }),
    // Chainable methods the migration calls
    project: vi.fn().mockReturnThis(),
    batchSize: vi.fn().mockReturnThis(),
  };
  return iter;
}

describe("migrateCharacterBalances", () => {
  it("creates currencyBalances from funds/cashOnHand for a US character", async () => {
    const { ObjectId } = await import("mongodb");
    const charId = new ObjectId();
    const cursor = mockCursor([{ _id: charId, countryId: "US", funds: 50000, cashOnHand: 25000 }]);
    db.collection("characters").find.mockReturnValue(cursor);
    db.collection("characters").bulkWrite.mockResolvedValue({ modifiedCount: 1 });

    const { migrateCharacterBalances } = await import("./migration");
    const result = await migrateCharacterBalances(db as unknown as Db);

    expect(result.processed).toBe(1);
    expect(result.skipped).toBe(0);

    const bulkWriteCall = db.collection("characters").bulkWrite.mock.calls[0][0];
    expect(bulkWriteCall).toHaveLength(1);
    expect(bulkWriteCall[0]).toEqual({
      updateOne: {
        filter: { _id: charId },
        update: {
          $set: {
            "currencyBalances.campaign": 50000,
            funds: 50000,
            // US rate = 1.0, so cashOnHand carries over unchanged
            "currencyBalances.personal": { USD: 25000 },
            displayCurrencyPreference: "local",
            autoConvertEnabled: true,
            updatedAt: expect.any(Date),
          },
        },
      },
    });
  });

  it("treats undefined cashOnHand as 0", async () => {
    const { ObjectId } = await import("mongodb");
    const charId = new ObjectId();
    const cursor = mockCursor([{ _id: charId, countryId: "UK", funds: 30000 }]);
    db.collection("characters").find.mockReturnValue(cursor);
    db.collection("characters").bulkWrite.mockResolvedValue({ modifiedCount: 1 });

    const { migrateCharacterBalances } = await import("./migration");
    const result = await migrateCharacterBalances(db as unknown as Db);

    expect(result.processed).toBe(1);
    const bulkWriteCall = db.collection("characters").bulkWrite.mock.calls[0][0];
    expect(bulkWriteCall[0].updateOne.update.$set["currencyBalances.personal"]).toEqual({
      GBP: 0,
    });
  });

  it("converts cashOnHand through home-currency rate for UK characters", async () => {
    const { ObjectId } = await import("mongodb");
    const charId = new ObjectId();
    const cursor = mockCursor([{ _id: charId, countryId: "UK", funds: 30000, cashOnHand: 100000 }]);
    db.collection("characters").find.mockReturnValue(cursor);
    db.collection("characters").bulkWrite.mockResolvedValue({ modifiedCount: 1 });

    const { migrateCharacterBalances } = await import("./migration");
    await migrateCharacterBalances(db as unknown as Db);

    const bulkWriteCall = db.collection("characters").bulkWrite.mock.calls[0][0];
    expect(bulkWriteCall[0].updateOne.update.$set.funds).toBe(30000);
    expect(bulkWriteCall[0].updateOne.update.$set["currencyBalances.campaign"]).toBe(22500);
    // UK rate = 0.75, so 100,000 internal → 75,000 GBP
    expect(bulkWriteCall[0].updateOne.update.$set["currencyBalances.personal"]).toEqual({
      GBP: 75_000,
    });
  });

  it("skips characters that already have currencyBalances (idempotent)", async () => {
    const { ObjectId } = await import("mongodb");
    const charId = new ObjectId();
    const cursor = mockCursor([
      {
        _id: charId,
        countryId: "JP",
        funds: 10000,
        cashOnHand: 5000,
        currencyBalances: { campaign: 10000, personal: { JPY: 5000 } },
      },
    ]);
    db.collection("characters").find.mockReturnValue(cursor);

    const { migrateCharacterBalances } = await import("./migration");
    const result = await migrateCharacterBalances(db as unknown as Db);

    expect(result.processed).toBe(0);
    expect(result.skipped).toBe(1);
    expect(db.collection("characters").bulkWrite).not.toHaveBeenCalled();
  });

  it("maps JP characters to JPY home currency and converts through rate", async () => {
    const { ObjectId } = await import("mongodb");
    const charId = new ObjectId();
    const cursor = mockCursor([{ _id: charId, countryId: "JP", funds: 10000, cashOnHand: 500000 }]);
    db.collection("characters").find.mockReturnValue(cursor);
    db.collection("characters").bulkWrite.mockResolvedValue({ modifiedCount: 1 });

    const { migrateCharacterBalances } = await import("./migration");
    await migrateCharacterBalances(db as unknown as Db);

    const bulkWriteCall = db.collection("characters").bulkWrite.mock.calls[0][0];
    expect(bulkWriteCall[0].updateOne.update.$set.funds).toBe(10000);
    expect(bulkWriteCall[0].updateOne.update.$set["currencyBalances.campaign"]).toBe(1_060_000);
    // JP rate = 106, so 500,000 internal → 53,000,000 JPY
    expect(bulkWriteCall[0].updateOne.update.$set["currencyBalances.personal"]).toEqual({
      JPY: 53_000_000,
    });
  });
});

describe("seedExchangeRates", () => {
  it("inserts an exchange rate document for every forex-active country", async () => {
    db.collection("exchangeRates").bulkWrite.mockResolvedValue({
      upsertedCount: FOREX_ACTIVE_COUNTRIES.length,
    });

    const { seedExchangeRates } = await import("./migration");
    await seedExchangeRates(db as unknown as Db, "2019-default");

    const bulkWriteCall = db.collection("exchangeRates").bulkWrite.mock.calls[0][0];
    expect(bulkWriteCall).toHaveLength(FOREX_ACTIVE_COUNTRIES.length);

    // Verify US entry
    const usOp = bulkWriteCall.find(
      (op: { updateOne: { filter: { _id: string } } }) => op.updateOne.filter._id === "US"
    );
    expect(usOp.updateOne.update.$setOnInsert).toMatchObject({
      countryId: "US",
      currencyCode: "USD",
      rate: 1.0,
      baseRate: 1.0,
      macroTarget: 1.0,
    });

    // Verify JP entry
    const jpOp = bulkWriteCall.find(
      (op: { updateOne: { filter: { _id: string } } }) => op.updateOne.filter._id === "JP"
    );
    expect(jpOp.updateOne.update.$setOnInsert).toMatchObject({
      countryId: "JP",
      currencyCode: "JPY",
      rate: 106.0,
      baseRate: 106.0,
    });

    // Verify NG entry — naira must seed so NG-bond proceeds are exchangeable
    const ngOp = bulkWriteCall.find(
      (op: { updateOne: { filter: { _id: string } } }) => op.updateOne.filter._id === "NG"
    );
    expect(ngOp.updateOne.update.$setOnInsert).toMatchObject({
      countryId: "NG",
      currencyCode: "NGN",
      rate: 1550,
      baseRate: 1550,
    });
  });

  it("uses upsert to be idempotent", async () => {
    db.collection("exchangeRates").bulkWrite.mockResolvedValue({ upsertedCount: 0 });

    const { seedExchangeRates } = await import("./migration");
    await seedExchangeRates(db as unknown as Db, "2019-default");

    const bulkWriteCall = db.collection("exchangeRates").bulkWrite.mock.calls[0][0];
    for (const op of bulkWriteCall) {
      expect(op.updateOne.upsert).toBe(true);
    }
  });
});

describe("updateCentralBanks", () => {
  it("upserts all FOREX_ACTIVE_COUNTRIES including DE via bulkWrite", async () => {
    db.collection("centralBanks").bulkWrite.mockResolvedValue({ upsertedCount: 1 });

    const { updateCentralBanks } = await import("./migration");
    await updateCentralBanks(db as unknown as Db);

    const calls = db.collection("centralBanks").bulkWrite.mock.calls;
    expect(calls).toHaveLength(1);
    const ops = calls[0][0] as Array<{ updateOne: { filter: unknown; upsert: boolean } }>;
    // All four forex-active countries must be present — DE resolves to ECB via getBankId
    const filters = ops.map((op) => op.updateOne.filter);
    expect(filters).toEqual(
      expect.arrayContaining([{ _id: "US" }, { _id: "UK" }, { _id: "JP" }, { _id: "ECB" }])
    );
    // Every op must request upsert so missing documents get created
    expect(ops.every((op) => op.updateOne.upsert === true)).toBe(true);
    // $set must reset tradeGrowth (not forexRevenue — $setOnInsert guards existing revenue)
    for (const op of ops) {
      const update = op.updateOne as unknown as { update: { $set: Record<string, unknown> } };
      expect(update.update.$set).toMatchObject({ tradeGrowth: 0 });
    }
  });
});

describe("migrateCorporationLiquidCapital", () => {
  it("sets liquidCurrencyCode and converts balance for non-USD corps", async () => {
    const { ObjectId } = await import("mongodb");
    const corpId = new ObjectId();
    const cursor = mockCursor([{ _id: corpId, countryId: "UK", liquidCapital: 1_000_000 }]);
    db.collection("corporations").find.mockReturnValue(cursor);
    db.collection("exchangeRates").find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        { countryId: "US", currencyCode: "USD", rate: 1.0 },
        { countryId: "UK", currencyCode: "GBP", rate: 0.75 },
        { countryId: "JP", currencyCode: "JPY", rate: 106.0 },
      ]),
    });
    db.collection("corporations").bulkWrite.mockResolvedValue({ modifiedCount: 1 });

    const { migrateCorporationLiquidCapital } = await import("./migration");
    const result = await migrateCorporationLiquidCapital(db as unknown as import("mongodb").Db);

    expect(result.processed).toBe(1);
    expect(result.skipped).toBe(0);

    const bulkOps = db.collection("corporations").bulkWrite.mock.calls[0][0];
    expect(bulkOps).toHaveLength(1);
    expect(bulkOps[0].updateOne.filter._id).toEqual(corpId);
    expect(bulkOps[0].updateOne.update.$set.liquidCurrencyCode).toBe("GBP");
    // 1,000,000 × 0.75 = 750,000
    expect(bulkOps[0].updateOne.update.$set.liquidCapital).toBe(750_000);
  });

  it("sets USD for US corps without converting the balance", async () => {
    const { ObjectId } = await import("mongodb");
    const corpId = new ObjectId();
    const cursor = mockCursor([{ _id: corpId, countryId: "US", liquidCapital: 500_000 }]);
    db.collection("corporations").find.mockReturnValue(cursor);
    db.collection("exchangeRates").find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        { countryId: "US", currencyCode: "USD", rate: 1.0 },
        { countryId: "UK", currencyCode: "GBP", rate: 0.75 },
      ]),
    });
    db.collection("corporations").bulkWrite.mockResolvedValue({ modifiedCount: 1 });

    const { migrateCorporationLiquidCapital } = await import("./migration");
    await migrateCorporationLiquidCapital(db as unknown as import("mongodb").Db);

    const bulkOps = db.collection("corporations").bulkWrite.mock.calls[0][0];
    expect(bulkOps[0].updateOne.update.$set.liquidCurrencyCode).toBe("USD");
    // No net conversion — USD rate is 1.0
    expect(bulkOps[0].updateOne.update.$set.liquidCapital).toBe(500_000);
  });

  it("skips corps that already have liquidCurrencyCode set", async () => {
    const { ObjectId } = await import("mongodb");
    const corpId = new ObjectId();
    const cursor = mockCursor([
      { _id: corpId, countryId: "UK", liquidCapital: 750_000, liquidCurrencyCode: "GBP" },
    ]);
    db.collection("corporations").find.mockReturnValue(cursor);
    db.collection("exchangeRates").find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        { countryId: "US", currencyCode: "USD", rate: 1.0 },
        { countryId: "UK", currencyCode: "GBP", rate: 0.75 },
      ]),
    });

    const { migrateCorporationLiquidCapital } = await import("./migration");
    const result = await migrateCorporationLiquidCapital(db as unknown as import("mongodb").Db);

    expect(result.processed).toBe(0);
    expect(result.skipped).toBe(1);
    expect(db.collection("corporations").bulkWrite).not.toHaveBeenCalled();
  });
});

describe("createForexIndexes", () => {
  it("creates indexes on tradeHistory and currencyOrders", async () => {
    db.collection("tradeHistory").createIndex.mockResolvedValue("turn_-1");
    db.collection("currencyOrders").createIndex.mockResolvedValue("status_1_expiresAtTurn_1");

    const { createForexIndexes } = await import("./migration");
    await createForexIndexes(db as unknown as Db);

    expect(db.collection("tradeHistory").createIndex).toHaveBeenCalledWith(
      { turn: -1 },
      { background: true }
    );
    expect(db.collection("tradeHistory").createIndex).toHaveBeenCalledWith(
      { buyerCharacterId: 1, turn: -1 },
      { background: true }
    );
    expect(db.collection("currencyOrders").createIndex).toHaveBeenCalledWith(
      { status: 1, expiresAtTurn: 1 },
      { background: true }
    );
  });
});
