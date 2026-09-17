import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import type { Db } from "mongodb";
import { processForexTurn } from "./forexTurn";
import {
  CYCLE_PRESSURE_REGIMES,
  CYCLE_PRESSURE_TURNS,
  ECONOMIC_BASELINES,
  MONETARY_BASELINES,
  INITIAL_RATES,
  INITIAL_RATES_1953,
  type CurrencyCyclePressureRegime,
} from "@/lib/constants/currencies";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

const { supportMock } = vi.hoisted(() => ({ supportMock: vi.fn() }));

// The keyed turn-fill primitive settles through runWithOptionalTransaction:
// resolving the probe false exercises the sequential (non-transaction)
// branch, which never touches getMongoClient — so the mock above
// deliberately provides no getMongoClient, and any session-path regression
// surfaces as a missing-export throw instead of a silent pass.
vi.mock("@/lib/db/transactionSupport", () => ({
  assertTransactionSupportAtBoot: supportMock,
}));

// Mock volume tracker to avoid second-order DB mocking
vi.mock("@/lib/currency/volumeTracker", () => ({
  computeCurrencyVolumes: vi.fn().mockResolvedValue({
    USD: { buyVolume24: 0, sellVolume24: 0 },
    GBP: { buyVolume24: 0, sellVolume24: 0 },
    JPY: { buyVolume24: 0, sellVolume24: 0 },
  }),
}));

let db: MockDb;

function makeCentralBank(countryId: string, overrides: Record<string, unknown> = {}) {
  return {
    _id: countryId,
    countryId,
    primeRate: 2.5,
    inflationHistory: [{ turn: 49, rate: 2.0 }],
    gdpGrowthHistory: [{ turn: 49, rate: 2.5 }],
    tradeGrowth: 0,
    ...overrides,
  };
}

function makeExchangeRate(countryId: string, currencyCode: string, rate: number, baseRate: number) {
  return {
    _id: countryId,
    countryId,
    currencyCode,
    rate,
    baseRate,
    macroTarget: rate,
    rateHistory: [],
    buyVolume24: 0,
    sellVolume24: 0,
    updatedAt: new Date(),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  supportMock.mockResolvedValue(false);
  db = createMockDb();

  // Pre-initialize all collections that forexTurn accesses
  db.collection("centralBanks");
  db.collection("exchangeRates");
  db.collection("currencyOrders");
  db.collection("tradeHistory");
  db.collection("characters");
  db.collection("nonAtomicMoneyFlowReceipts");

  // Default: 3 central banks with neutral values
  const banks = [
    makeCentralBank("US"),
    makeCentralBank("UK", {
      primeRate: 2.0,
      inflationHistory: [{ turn: 49, rate: 2.0 }],
      gdpGrowthHistory: [{ turn: 49, rate: 1.5 }],
    }),
    makeCentralBank("JP", {
      primeRate: 0.1,
      inflationHistory: [{ turn: 49, rate: 0.5 }],
      gdpGrowthHistory: [{ turn: 49, rate: 1.0 }],
    }),
  ];
  db.collectionMocks.centralBanks.find.mockReturnValue({
    toArray: vi.fn().mockResolvedValue(banks),
    sort: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    skip: vi.fn().mockReturnThis(),
    project: vi.fn().mockReturnThis(),
  });

  // Default: existing exchange rate docs
  db.collectionMocks.exchangeRates.findOne.mockImplementation((filter: { _id: string }) => {
    const rates: Record<string, ReturnType<typeof makeExchangeRate>> = {
      US: makeExchangeRate("US", "USD", 1.0, 1.0),
      UK: makeExchangeRate("UK", "GBP", 0.75, 0.75),
      JP: makeExchangeRate("JP", "JPY", 106.0, 106.0),
    };
    return Promise.resolve(rates[filter._id] ?? null);
  });
  db.collectionMocks.exchangeRates.find.mockReturnValue({
    toArray: vi
      .fn()
      .mockResolvedValue([
        makeExchangeRate("US", "USD", 1.0, 1.0),
        makeExchangeRate("UK", "GBP", 0.75, 0.75),
        makeExchangeRate("JP", "JPY", 106.0, 106.0),
      ]),
    sort: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    skip: vi.fn().mockReturnThis(),
    project: vi.fn().mockReturnThis(),
  });

  // Default: no open limit orders
  db.collectionMocks.currencyOrders.find.mockReturnValue({
    toArray: vi.fn().mockResolvedValue([]),
    sort: vi.fn().mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      project: vi.fn().mockReturnThis(),
    }),
    limit: vi.fn().mockReturnThis(),
    skip: vi.fn().mockReturnThis(),
    project: vi.fn().mockReturnThis(),
  });
});

describe("processForexTurn", () => {
  it("updates all 3 forex-active countries", async () => {
    const result = await processForexTurn(db as unknown as Db, 50);
    expect(result.countriesUpdated).toBe(3);
  });

  it("writes updated rate and history to exchangeRates", async () => {
    await processForexTurn(db as unknown as Db, 50);

    const updateCalls = db.collectionMocks.exchangeRates.updateOne.mock.calls;
    expect(updateCalls.length).toBe(3); // US, UK, JP

    // Check that each call updates rate, macroTarget, rateHistory
    for (const call of updateCalls) {
      const $set = call[1].$set;
      expect($set).toHaveProperty("rate");
      expect($set).toHaveProperty("macroTarget");
      expect($set).toHaveProperty("rateHistory");
      expect($set).toHaveProperty("updatedAt");
    }
  });

  it("seeds exchange rate if document does not exist", async () => {
    // Make find return no US doc — simulates first run
    db.collectionMocks.exchangeRates.find.mockReturnValue({
      toArray: vi
        .fn()
        .mockResolvedValue([
          makeExchangeRate("UK", "GBP", 0.75, 0.75),
          makeExchangeRate("JP", "JPY", 106.0, 106.0),
        ]),
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      project: vi.fn().mockReturnThis(),
    });

    await processForexTurn(db as unknown as Db, 50);

    // Should have inserted a new document for US
    expect(db.collectionMocks.exchangeRates.insertOne).toHaveBeenCalledWith(
      expect.objectContaining({
        _id: "US",
        countryId: "US",
        currencyCode: "USD",
        rate: 1.0,
        baseRate: 1.0,
      })
    );
  });

  it("prunes rate history to FOREX_AND_MACRO_CHART_HISTORY_TURNS entries", async () => {
    const { FOREX_AND_MACRO_CHART_HISTORY_TURNS } = await import("@/lib/constants/turnTime");
    // Give US a full-cap history
    const fullHistory = Array.from({ length: FOREX_AND_MACRO_CHART_HISTORY_TURNS }, (_, i) => ({
      turn: i + 1,
      rate: 1.0,
    }));
    db.collectionMocks.exchangeRates.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        {
          ...makeExchangeRate("US", "USD", 1.0, 1.0),
          rateHistory: fullHistory,
        },
        makeExchangeRate("UK", "GBP", 0.75, 0.75),
        makeExchangeRate("JP", "JPY", 106.0, 106.0),
      ]),
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      project: vi.fn().mockReturnThis(),
    });

    await processForexTurn(db as unknown as Db, 50);

    // Find the US update call
    const usCall = db.collectionMocks.exchangeRates.updateOne.mock.calls.find(
      (call: Array<{ _id: string }>) => call[0]._id === "US"
    );
    expect(usCall).toBeDefined();
    // History should still be at cap (added 1, pruned to cap)
    expect(usCall![1].$set.rateHistory).toHaveLength(FOREX_AND_MACRO_CHART_HISTORY_TURNS);
    // Last entry should be turn 50
    expect(usCall![1].$set.rateHistory.at(-1).turn).toBe(50);
  });

  it("returns zero limit orders when none are open", async () => {
    const result = await processForexTurn(db as unknown as Db, 50);
    expect(result.limitOrdersFilled).toBe(0);
    expect(result.limitOrdersExpired).toBe(0);
    expect(result.totalSpreadRevenue).toBe(0);
  });

  it("expires orders and refunds escrowed funds through the keyed flow", async () => {
    const { ObjectId } = await import("mongodb");
    const { forexExpireKey, forexExpireFingerprint } = await import("@/lib/forex/forexSpend");
    const charId = new ObjectId();
    const orderId = new ObjectId();

    const expiringOrder = {
      _id: orderId,
      characterId: charId,
      characterName: "Trader",
      type: "limit",
      fromCurrency: "USD",
      toCurrency: "GBP",
      amount: 1000,
      filledAmount: 200,
      status: "partial",
      expiresAtTurn: 49,
      spreadCharged: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const cursorFor = (docs: unknown[]) => {
      const cursor = {
        toArray: vi.fn().mockResolvedValue(docs),
        sort: vi.fn().mockReturnValue({
          toArray: vi.fn().mockResolvedValue(docs),
        }),
        limit: vi.fn(),
        skip: vi.fn().mockReturnThis(),
        project: vi.fn().mockReturnThis(),
      };
      cursor.limit.mockReturnValue(cursor);
      return cursor;
    };

    // Route each find by its filter: fill scan (type limit), receipt
    // recovery (_id regex), eligibility scan (status + expiry).
    db.collectionMocks.currencyOrders.find.mockImplementation((filter: Record<string, unknown>) => {
      if ((filter as { type?: string }).type === "limit") return cursorFor([]);
      return cursorFor([{ _id: orderId }]);
    });
    db.collectionMocks.nonAtomicMoneyFlowReceipts.find.mockImplementation(() => cursorFor([]));
    db.collectionMocks.currencyOrders.findOne.mockImplementation((filter: { _id: unknown }) =>
      Promise.resolve(filter._id === orderId ? expiringOrder : null)
    );

    const result = await processForexTurn(db as unknown as Db, 50);
    expect(result.limitOrdersExpired).toBe(1);

    // The eligibility scan uses the legacy filter, id-projected.
    expect(db.collectionMocks.currencyOrders.find).toHaveBeenCalledWith(
      expect.objectContaining({
        status: { $in: ["open", "partial"] },
        expiresAtTurn: { $lte: 50 },
      }),
      expect.objectContaining({ projection: { _id: 1 } })
    );

    // The order ran under its stable order-derived key and fingerprint.
    const claimCall = db.collectionMocks.nonAtomicMoneyFlowReceipts.insertOne.mock.calls[0];
    expect(claimCall[0]).toMatchObject({
      _id: forexExpireKey(orderId),
      fingerprint: forexExpireFingerprint(orderId),
      status: "in_progress",
    });

    // Guarded terminal transition (open/partial → expired), not a bulk write.
    const expireCall = db.collectionMocks.currencyOrders.updateOne.mock.calls.find(
      (call: Array<Record<string, unknown>>) =>
        String((call[0] as { _id: unknown })._id) === String(orderId)
    );
    expect(expireCall).toBeDefined();
    expect(expireCall![1]).toMatchObject({
      $set: expect.objectContaining({ status: "expired" }),
    });

    // Refund issued as a keyed leg: 1000 - 200 = 800 USD, same field the
    // legacy bulkWrite credited.
    const refundCall = db.collectionMocks.characters.updateOne.mock.calls.find(
      (call: Array<Record<string, unknown>>) =>
        String((call[0] as { _id: unknown })._id) === String(charId)
    );
    expect(refundCall).toBeDefined();
    expect(refundCall![1]).toMatchObject({
      $inc: expect.objectContaining({ "currencyBalances.personal.USD": 800 }),
    });
    expect(db.collectionMocks.characters.bulkWrite).not.toHaveBeenCalled();

    // The receipt settled completed.
    const settleCall = db.collectionMocks.nonAtomicMoneyFlowReceipts.updateOne.mock.calls.find(
      (call: Array<Record<string, unknown>>) =>
        (call[0] as { _id: unknown })._id === forexExpireKey(orderId)
    );
    expect(settleCall).toBeDefined();
    expect(settleCall![1]).toMatchObject({
      $set: expect.objectContaining({ status: "completed" }),
    });
  });

  it("expires nothing and writes no receipts when no orders are due", async () => {
    const result = await processForexTurn(db as unknown as Db, 50);

    expect(result.limitOrdersExpired).toBe(0);
    // Recovery scan ran (empty), the eligibility scan found nothing, and no
    // expiry receipt was ever claimed.
    expect(db.collectionMocks.nonAtomicMoneyFlowReceipts.find).toHaveBeenCalledWith(
      expect.objectContaining({
        _id: { $regex: "^forex-expire:" },
        status: "in_progress",
      })
    );
    expect(db.collectionMocks.nonAtomicMoneyFlowReceipts.insertOne).not.toHaveBeenCalled();
    expect(db.collectionMocks.characters.updateOne).not.toHaveBeenCalled();
    expect(db.collectionMocks.characters.bulkWrite).not.toHaveBeenCalled();
  });

  it("stores triggered limit-order reserve spread fees in the collected currency", async () => {
    const { ObjectId } = await import("mongodb");
    const { forexTurnFillKey } = await import("@/lib/forex/forexSpend");
    const charId = new ObjectId();
    const orderId = new ObjectId();
    // Mutable fill state: the scan hands out the open order, the keyed
    // settle flips it, and the primitive's findOne reads observe the flip.
    let orderStatus = "open";
    let orderFilledAmount = 0;
    const order = {
      _id: orderId,
      characterId: charId,
      characterName: "Trader",
      type: "limit",
      direction: "buy",
      fromCurrency: "USD",
      toCurrency: "GBP",
      amount: 10_000,
      filledAmount: 0,
      limitRate: 0.7,
      status: "open",
      expiresAtTurn: 60,
      spreadCharged: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const cursorFor = (docs: unknown[]) => ({
      toArray: vi.fn().mockResolvedValue(docs),
      sort: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue(docs),
      }),
      limit: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      project: vi.fn().mockReturnThis(),
    });
    db.collectionMocks.currencyOrders.find.mockImplementation(() => cursorFor([order]));
    // The real primitive reads single docs (pre-claim live read, then the
    // settled-status read with a projection) — not the scan cursor.
    db.collectionMocks.currencyOrders.findOne.mockImplementation(
      async (filter: { _id: unknown }, opts?: { projection?: unknown }) => {
        if (String(filter._id) !== String(orderId)) return null;
        if (opts?.projection) return { _id: orderId, status: orderStatus };
        return { ...order, status: orderStatus, filledAmount: orderFilledAmount };
      }
    );
    db.collectionMocks.currencyOrders.updateOne.mockImplementation(
      async (filter: Record<string, unknown>) => {
        if (String(filter._id) === String(orderId)) {
          orderStatus = "filled";
          orderFilledAmount = 10_000;
        }
        return { modifiedCount: 1, matchedCount: 1 };
      }
    );
    db.collectionMocks.characters.findOne.mockResolvedValue({
      _id: charId,
      currencyBalances: { personal: { USD: 0, GBP: 0 } },
      appliedMoneyFlowKeys: [],
    });

    // Minimal stateful receipt store: claim insert, plan/$set updates, reads.
    const receiptStore = new Map<string, Record<string, unknown>>();
    db.collectionMocks.nonAtomicMoneyFlowReceipts.findOne.mockImplementation(
      async (filter: { _id: string }) => receiptStore.get(filter._id) ?? null
    );
    db.collectionMocks.nonAtomicMoneyFlowReceipts.insertOne.mockImplementation(
      async (doc: Record<string, unknown>) => {
        if (receiptStore.has(doc._id as string)) {
          const error = new Error("E11000 duplicate key error") as Error & { code: number };
          error.code = 11000;
          throw error;
        }
        receiptStore.set(doc._id as string, { ...doc });
        return { insertedId: doc._id };
      }
    );
    db.collectionMocks.nonAtomicMoneyFlowReceipts.updateOne.mockImplementation(
      async (filter: { _id: string }, update: { $set?: Record<string, unknown> }) => {
        const doc = receiptStore.get(filter._id);
        if (!doc) return { matchedCount: 0, modifiedCount: 0 };
        Object.assign(doc, update.$set ?? {});
        return { matchedCount: 1, modifiedCount: 1 };
      }
    );

    const result = await processForexTurn(db as unknown as Db, 50);

    expect(result.limitOrdersFilled).toBe(1);
    // The fill ran through the keyed primitive, not bare writes: the
    // topology probe was consulted, the order was read via findOne (live
    // read, then the settled-status read), and the receipt was claimed
    // under the deterministic per-turn key.
    expect(supportMock).toHaveBeenCalled();
    expect(db.collectionMocks.currencyOrders.findOne).toHaveBeenCalledWith({ _id: orderId }, {});
    expect(
      db.collectionMocks.currencyOrders.findOne.mock.calls.some(
        (call: unknown[]) =>
          String((call[0] as { _id: unknown })._id) === String(orderId) &&
          (call[1] as { projection?: unknown } | undefined)?.projection !== undefined
      )
    ).toBe(true);
    const expectedKey = forexTurnFillKey(50, orderId);
    const claimCall = db.collectionMocks.nonAtomicMoneyFlowReceipts.insertOne.mock.calls[0];
    expect(claimCall[0]).toMatchObject({ _id: expectedKey, status: "in_progress" });
    expect(receiptStore.get(expectedKey)?.status).toBe("completed");
    // Cross-currency routing: the USD reserve slice (outflow currency) now
    // accrues to the *destination* (GBP→UK) central bank as a foreign reserve,
    // while forexRevenue stays with the source (US) bank.
    const reserveCall = db.collectionMocks.centralBanks.updateOne.mock.calls.find(
      (call: Array<Record<string, unknown>>) => {
        const inc = call[1].$inc as Record<string, number> | undefined;
        return call[0]._id === "UK" && (inc?.["spreadFeeReserveBalances.USD"] ?? 0) > 0;
      }
    );
    expect(reserveCall).toBeDefined();
    expect((reserveCall![1].$inc as Record<string, number>).reserveBalance).toBeUndefined();
    // forexRevenue routes to the source (US) bank, with no reserve slice attached.
    const forexRevenueCall = db.collectionMocks.centralBanks.updateOne.mock.calls.find(
      (call: Array<Record<string, unknown>>) => {
        const inc = call[1].$inc as Record<string, number> | undefined;
        return call[0]._id === "US" && inc?.forexRevenue !== undefined;
      }
    );
    expect(forexRevenueCall).toBeDefined();
    expect(
      (forexRevenueCall![1].$inc as Record<string, number>)["spreadFeeReserveBalances.USD"]
    ).toBeUndefined();
  });

  it("re-drives an in-progress prior-turn fill receipt before scanning", async () => {
    const { ObjectId } = await import("mongodb");
    const { forexTurnFillKey } = await import("@/lib/forex/forexSpend");
    const charId = new ObjectId();
    const orderId = new ObjectId();
    const historyId = new ObjectId();
    // Legacy-exact plan for a 10_000 USD -> GBP fill at 0.75: spread 64,
    // net 9936, credit 7452, CB share 48, reserve 32, revenue 16.
    const orphanKey = forexTurnFillKey(49, orderId);
    const orphan = {
      _id: orphanKey,
      status: "in_progress",
      fingerprint: "forex-turn-fill:old",
      forexTurnFillPlan: {
        version: 1,
        orderIdHex: orderId.toHexString(),
        turn: 49,
        characterIdHex: charId.toHexString(),
        fromCurrency: "USD",
        toCurrency: "GBP",
        priorStatus: "open",
        orderAmount: 10_000,
        priorFilledAmount: 0,
        priorSpreadCharged: 0,
        priorFilledRate: null,
        priorUpdatedAtIso: new Date().toISOString(),
        fillAmount: 10_000,
        crossRate: 0.75,
        spreadAmount: 64,
        netAmount: 9_936,
        toAmount: 7_452,
        toReserveBalance: 32,
        toForexRevenue: 16,
        fromBankId: "US",
        reserveBankId: "UK",
        historyIdHex: historyId.toHexString(),
        ownerMissing: false,
        nowIso: new Date().toISOString(),
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const receiptStore = new Map<string, Record<string, unknown>>([[orphanKey, { ...orphan }]]);

    const cursorFor = (docs: unknown[]) => ({
      toArray: vi.fn().mockResolvedValue(docs),
      sort: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue(docs),
      }),
      limit: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      project: vi.fn().mockReturnThis(),
    });
    db.collectionMocks.nonAtomicMoneyFlowReceipts.find.mockImplementation(() =>
      cursorFor([...receiptStore.values()].filter((r) => r.status === "in_progress"))
    );
    db.collectionMocks.nonAtomicMoneyFlowReceipts.findOne.mockImplementation(
      async (filter: { _id: string }) => receiptStore.get(filter._id) ?? null
    );
    db.collectionMocks.nonAtomicMoneyFlowReceipts.updateOne.mockImplementation(
      async (filter: { _id: string }, update: { $set?: Record<string, unknown> }) => {
        const doc = receiptStore.get(filter._id);
        if (!doc) return { matchedCount: 0, modifiedCount: 0 };
        Object.assign(doc, update.$set ?? {});
        return { matchedCount: 1, modifiedCount: 1 };
      }
    );

    // The live scan is empty (the orphaned order already settled out of the
    // open/partial scan); the $in read backs the recovery notification.
    let orderStatus = "open";
    const recoveredOrder = {
      _id: orderId,
      characterId: charId,
      characterName: "Trader",
      fromCurrency: "USD",
      toCurrency: "GBP",
      status: "open",
    };
    db.collectionMocks.currencyOrders.find.mockImplementation((filter: Record<string, unknown>) =>
      filter?._id && typeof filter._id === "object" && "$in" in (filter._id as object)
        ? cursorFor([{ ...recoveredOrder, status: orderStatus }])
        : cursorFor([])
    );
    db.collectionMocks.currencyOrders.findOne.mockImplementation(
      async (filter: { _id: unknown }, opts?: { projection?: unknown }) => {
        if (String(filter._id) !== String(orderId)) return null;
        if (opts?.projection) return { _id: orderId, status: orderStatus };
        return { ...recoveredOrder, status: orderStatus };
      }
    );
    db.collectionMocks.currencyOrders.updateOne.mockImplementation(
      async (filter: Record<string, unknown>) => {
        if (String(filter._id) === String(orderId)) orderStatus = "filled";
        return { modifiedCount: 1, matchedCount: 1 };
      }
    );
    db.collectionMocks.characters.findOne.mockResolvedValue({
      _id: charId,
      currencyBalances: { personal: { USD: 0, GBP: 0 } },
      appliedMoneyFlowKeys: [],
    });

    const result = await processForexTurn(db as unknown as Db, 50);

    // The orphan converged through its stored plan: credit, settle, spread
    // slices, and history all landed exactly once under the old key.
    expect(result.limitOrdersFilled).toBe(1);
    expect(result.totalSpreadRevenue).toBe(48);
    expect(receiptStore.get(orphanKey)?.status).toBe("completed");
    const creditCall = db.collectionMocks.characters.updateOne.mock.calls.find(
      (call: Array<Record<string, unknown>>) =>
        (call[1].$inc as Record<string, number> | undefined)?.["currencyBalances.personal.GBP"] ===
        7_452
    );
    expect(creditCall).toBeDefined();
    expect(db.collectionMocks.tradeHistory.insertOne).toHaveBeenCalledWith(
      expect.objectContaining({ _id: historyId }),
      undefined
    );
  });

  it("rate stays near base with neutral macro inputs and no volume", async () => {
    await processForexTurn(db as unknown as Db, 50);

    const usCall = db.collectionMocks.exchangeRates.updateOne.mock.calls.find(
      (call: Array<{ _id: string }>) => call[0]._id === "US"
    );
    // With neutral inputs and zero noise, rate should be very close to 1.0
    // (noise introduces +/-0.3% jitter so we allow that)
    const newRate = usCall![1].$set.rate;
    expect(newRate).toBeGreaterThan(0.99);
    expect(newRate).toBeLessThan(1.01);
  });

  it("high US inflation raises macroTarget and updated rate vs neutral baseline", async () => {
    const banks = [
      makeCentralBank("US", {
        inflationHistory: [{ turn: 49, rate: 9.0 }],
      }),
      makeCentralBank("UK"),
      makeCentralBank("JP"),
    ];
    db.collectionMocks.centralBanks.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue(banks),
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      project: vi.fn().mockReturnThis(),
    });

    await processForexTurn(db as unknown as Db, 50);

    const usCall = db.collectionMocks.exchangeRates.updateOne.mock.calls.find(
      (call: Array<{ _id: string }>) => call[0]._id === "US"
    );
    expect(usCall).toBeDefined();
    const $set = usCall![1].$set as { macroTarget: number; rate: number };
    // +7pp inflation vs 2% baseline adds 0.105; 2.5% prime vs 3% neutral adds 0.01;
    // absolute-inflation penalty (9-6)*0.015 adds 0.045 (#3064 Phase 2) → 1.16.
    expect($set.macroTarget).toBeCloseTo(1.16, 3);
    // Drift pushes above 1.0; per-turn noise is small but non-deterministic
    expect($set.rate).toBeGreaterThan(1.0);
    expect($set.rate).toBeLessThan(1.1);
  });

  describe("intervention integration", () => {
    async function setupIntervention({
      rate,
      floor,
      ceiling,
      forexRevenue,
      reserveBalance,
      spreadFeeReserveBalances,
      chairCharacterId,
      chairInfamy,
      lastInfamyChargedAtTurn,
      hardPeg,
    }: {
      rate: number;
      floor: number;
      ceiling: number;
      forexRevenue: number;
      reserveBalance: number;
      spreadFeeReserveBalances?: Record<string, number>;
      chairCharacterId?: import("mongodb").ObjectId | null;
      chairInfamy?: number;
      lastInfamyChargedAtTurn?: number;
      hardPeg?: number;
    }) {
      const { ObjectId } = await import("mongodb");
      const chairId = chairCharacterId === undefined ? new ObjectId() : chairCharacterId;
      const banks = [
        makeCentralBank("US", {
          forexRevenue,
          reserveBalance,
          spreadFeeReserveBalances,
          chairCharacterId: chairId,
          chairCharacterName: chairId ? "Test Chair" : null,
          chairInfamy: chairInfamy ?? 0,
        }),
        makeCentralBank("UK"),
        makeCentralBank("JP"),
      ];
      db.collectionMocks.centralBanks.find.mockReturnValue({
        toArray: vi.fn().mockResolvedValue(banks),
        sort: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        skip: vi.fn().mockReturnThis(),
        project: vi.fn().mockReturnThis(),
      });

      const setByCharacterId = new ObjectId();
      db.collectionMocks.exchangeRates.find.mockReturnValue({
        toArray: vi.fn().mockResolvedValue([
          {
            ...makeExchangeRate("US", "USD", rate, 1.0),
            ...(hardPeg !== undefined ? { hardPeg } : {}),
            interventionPolicy: {
              floor,
              ceiling,
              setByCharacterId,
              setByCharacterName: "Prior Chair",
              setAtTurn: 40,
              lastAdjustedAtTurn: 40,
              ...(lastInfamyChargedAtTurn !== undefined ? { lastInfamyChargedAtTurn } : {}),
              recentInterventions: [],
            },
          },
          makeExchangeRate("UK", "GBP", 0.75, 0.75),
          makeExchangeRate("JP", "JPY", 106.0, 106.0),
        ]),
        sort: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        skip: vi.fn().mockReturnThis(),
        project: vi.fn().mockReturnThis(),
      });

      // Characters lookup for system-mail path
      if (chairId) {
        db.collectionMocks.characters.findOne.mockImplementation(async () => ({
          _id: chairId,
          userId: new ObjectId(),
          name: "Test Chair",
          sequentialId: 42,
        }));
      }

      return { chairId };
    }

    function usUpdateCall() {
      return db.collectionMocks.exchangeRates.updateOne.mock.calls.find(
        (call: Array<{ _id: string }>) => call[0]._id === "US"
      );
    }

    function usBankUpdateCalls() {
      return db.collectionMocks.centralBanks.updateOne.mock.calls.filter(
        (call: Array<{ _id: string }>) => call[0]._id === "US"
      );
    }

    it("does not spend when rate is inside band", async () => {
      await setupIntervention({
        rate: 1.0,
        floor: 0.95,
        ceiling: 1.05,
        forexRevenue: 10_000,
        reserveBalance: 0,
      });

      await processForexTurn(db as unknown as Db, 50);

      const bankInc = usBankUpdateCalls().find(
        (call: Array<Record<string, unknown>>) => call[1].$inc !== undefined
      );
      expect(bankInc).toBeUndefined();
      const call = usUpdateCall();
      const policy = call![1].$set.interventionPolicy;
      expect(policy.recentInterventions).toEqual([]);
    });

    it("buys home currency with foreign spread-fee reserves when rate breaches ceiling", async () => {
      await setupIntervention({
        rate: 1.15,
        floor: 0.95,
        ceiling: 1.05,
        forexRevenue: 0,
        reserveBalance: 0,
        spreadFeeReserveBalances: { GBP: 750_000 },
      });

      await processForexTurn(db as unknown as Db, 50);

      const bankInc = usBankUpdateCalls().find(
        (call: Array<Record<string, unknown>>) => call[1].$inc !== undefined
      );
      expect(bankInc).toBeDefined();
      const inc = bankInc![1].$inc as Record<string, number>;
      expect(inc["spreadFeeReserveBalances.GBP"]).toBe(-750_000);
      expect(inc["spreadFeeReserveBalances.USD"]).toBeGreaterThan(1_100_000);
      expect(inc.forexRevenue ?? 0).toBe(0);
      expect(inc.reserveBalance ?? 0).toBe(0);

      const policy = usUpdateCall()![1].$set.interventionPolicy;
      expect(policy.recentInterventions).toHaveLength(1);
      expect(policy.recentInterventions[0].fundingSource).toBe("spreadFeeReserves");
      expect(policy.recentInterventions[0].direction).toBe("buy");
    });

    it("falls through to reserveBalance when selling home currency and forexRevenue is empty", async () => {
      await setupIntervention({
        rate: 0.9,
        floor: 0.95,
        ceiling: 1.05,
        forexRevenue: 0,
        reserveBalance: 50_000,
      });

      await processForexTurn(db as unknown as Db, 50);

      const bankInc = usBankUpdateCalls().find(
        (call: Array<Record<string, unknown>>) => call[1].$inc !== undefined
      );
      expect(bankInc).toBeDefined();
      const inc = bankInc![1].$inc as Record<string, number>;
      expect(inc.reserveBalance).toBeLessThan(0);
      expect(inc["spreadFeeReserveBalances.GBP"]).toBeGreaterThan(0);
      expect(inc.forexRevenue ?? 0).toBe(0);

      const policy = usUpdateCall()![1].$set.interventionPolicy;
      expect(policy.recentInterventions[0].fundingSource).toBe("reserveBalance");
    });

    it("splits sell-side spend across home reserves and legacy pools", async () => {
      await setupIntervention({
        rate: 0.9,
        floor: 0.95,
        ceiling: 1.05,
        forexRevenue: 50,
        reserveBalance: 10_000,
        spreadFeeReserveBalances: { USD: 50 },
      });

      await processForexTurn(db as unknown as Db, 50);

      const bankInc = usBankUpdateCalls().find(
        (call: Array<Record<string, unknown>>) => call[1].$inc !== undefined
      );
      const inc = bankInc![1].$inc as Record<string, number>;
      expect(inc["spreadFeeReserveBalances.USD"]).toBe(-50);
      expect(inc.forexRevenue).toBe(-50);
      expect(inc.reserveBalance).toBeLessThan(0);
      expect(inc["spreadFeeReserveBalances.GBP"]).toBeGreaterThan(0);

      const policy = usUpdateCall()![1].$set.interventionPolicy;
      expect(policy.recentInterventions[0].fundingSource).toBe("mixed");
    });

    it("charges failure infamy when both pools deplete mid-breach", async () => {
      await setupIntervention({
        rate: 1.15,
        floor: 0.95,
        ceiling: 1.05,
        forexRevenue: 0,
        reserveBalance: 0,
        spreadFeeReserveBalances: { GBP: 3.75 },
      });

      await processForexTurn(db as unknown as Db, 50);

      const bankInc = usBankUpdateCalls().find(
        (call: Array<Record<string, unknown>>) => call[1].$inc !== undefined
      );
      const set = bankInc![1].$set as Record<string, number>;
      expect(set.chairInfamy).toBe(15);

      const policy = usUpdateCall()![1].$set.interventionPolicy;
      expect(policy.lastInfamyChargedAtTurn).toBe(50);

      // Chair notification was dispatched
      expect(db.collectionMocks.characters.findOne).toHaveBeenCalled();
    });

    it("does not charge infamy twice for the same breach cycle", async () => {
      await setupIntervention({
        rate: 1.15,
        floor: 0.95,
        ceiling: 1.05,
        forexRevenue: 0,
        reserveBalance: 0,
        spreadFeeReserveBalances: { GBP: 3.75 },
        lastInfamyChargedAtTurn: 48,
      });

      await processForexTurn(db as unknown as Db, 50);

      const bankInc = usBankUpdateCalls().find(
        (call: Array<Record<string, unknown>>) => call[1].$inc !== undefined
      );
      const inc = (bankInc?.[1].$inc ?? {}) as Record<string, number>;
      const set = (bankInc?.[1].$set ?? {}) as Record<string, number>;
      expect(inc.chairInfamy ?? 0).toBe(0);
      expect(set.chairInfamy).toBeUndefined();
    });

    it("caps failure infamy at 100 instead of creating hidden over-cap scrutiny", async () => {
      await setupIntervention({
        rate: 1.15,
        floor: 0.95,
        ceiling: 1.05,
        forexRevenue: 0,
        reserveBalance: 0,
        spreadFeeReserveBalances: { GBP: 3.75 },
        chairInfamy: 95,
      });

      await processForexTurn(db as unknown as Db, 50);

      const bankInc = usBankUpdateCalls().find((call: Array<Record<string, unknown>>) => {
        const update = call[1] as { $set?: Record<string, unknown> };
        return update.$set?.chairInfamy !== undefined;
      });
      expect(bankInc).toBeDefined();
      const set = bankInc![1].$set as Record<string, number>;
      expect(set.chairInfamy).toBe(100);
    });

    it("skips intervention entirely when hardPeg is set", async () => {
      await setupIntervention({
        rate: 1.15,
        floor: 0.95,
        ceiling: 1.05,
        forexRevenue: 10_000,
        reserveBalance: 10_000,
        hardPeg: 0.9,
      });

      await processForexTurn(db as unknown as Db, 50);

      const bankInc = usBankUpdateCalls().find(
        (call: Array<Record<string, unknown>>) => call[1].$inc !== undefined
      );
      expect(bankInc).toBeUndefined();

      // Policy's recentInterventions should still be empty on the write
      const policy = usUpdateCall()![1].$set.interventionPolicy;
      expect(policy.recentInterventions).toEqual([]);
    });

    it("continues intervention during chair vacancy without charging infamy", async () => {
      await setupIntervention({
        rate: 1.15,
        floor: 0.95,
        ceiling: 1.05,
        forexRevenue: 0,
        reserveBalance: 0,
        spreadFeeReserveBalances: { GBP: 3.75 },
        chairCharacterId: null,
      });

      await processForexTurn(db as unknown as Db, 50);

      const bankInc = usBankUpdateCalls().find(
        (call: Array<Record<string, unknown>>) => call[1].$inc !== undefined
      );
      const inc = (bankInc?.[1].$inc ?? {}) as Record<string, number>;
      expect(inc.chairInfamy ?? 0).toBe(0);
      // Reserves still drained
      expect(inc["spreadFeeReserveBalances.GBP"]).toBeLessThan(0);
    });
  });

  it("honors hardPeg and skips macro drift for that currency", async () => {
    db.collectionMocks.exchangeRates.find.mockReturnValue({
      toArray: vi
        .fn()
        .mockResolvedValue([
          { ...makeExchangeRate("US", "USD", 1.0, 1.0), hardPeg: 0.88 },
          makeExchangeRate("UK", "GBP", 0.75, 0.75),
          makeExchangeRate("JP", "JPY", 106.0, 106.0),
        ]),
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      project: vi.fn().mockReturnThis(),
    });

    const banks = [
      makeCentralBank("US", {
        inflationHistory: [{ turn: 49, rate: 12.0 }],
        primeRate: 6.0,
      }),
      makeCentralBank("UK"),
      makeCentralBank("JP"),
    ];
    db.collectionMocks.centralBanks.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue(banks),
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      project: vi.fn().mockReturnThis(),
    });

    await processForexTurn(db as unknown as Db, 50);

    const usCall = db.collectionMocks.exchangeRates.updateOne.mock.calls.find(
      (call: Array<{ _id: string }>) => call[0]._id === "US"
    );
    const $set = usCall![1].$set as { rate: number; macroTarget: number };
    expect($set.rate).toBe(0.88);
    expect($set.macroTarget).toBe(0.88);
  });
});

describe("era-aware macro-target anchor", () => {
  // JP's bank pinned exactly at its baselines so computeMacroTarget's multiplier
  // is exactly 1 → macroTarget === baseRate. The test then isolates WHICH rate
  // table anchors the target: the era-selected one, not the modern default.
  function setupNeutralJP(rate: number, baseRate: number) {
    const jp = makeCentralBank("JP", {
      primeRate: MONETARY_BASELINES.JP.neutralPrimeRate,
      inflationHistory: [{ turn: 49, rate: MONETARY_BASELINES.JP.targetInflation }],
      gdpGrowthHistory: [{ turn: 49, rate: ECONOMIC_BASELINES.JP!.gdpGrowth }],
      tradeGrowth: ECONOMIC_BASELINES.JP!.tradeGrowth,
    });
    db.collectionMocks.centralBanks.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([jp]),
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      project: vi.fn().mockReturnThis(),
    });
    db.collectionMocks.exchangeRates.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([makeExchangeRate("JP", "JPY", rate, baseRate)]),
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      project: vi.fn().mockReturnThis(),
    });
  }

  function jpMacroTarget(): number {
    const jpCall = db.collectionMocks.exchangeRates.updateOne.mock.calls.find(
      (call: Array<{ _id: string }>) => call[0]._id === "JP"
    );
    expect(jpCall).toBeDefined();
    return (jpCall![1].$set as { macroTarget: number }).macroTarget;
  }

  it("anchors JP's macroTarget at the 1953 Bretton Woods rate (360) in a 1953-era world", async () => {
    setupNeutralJP(360, 360);
    await processForexTurn(db as unknown as Db, 50, "1953-default");
    expect(INITIAL_RATES_1953.JP).toBe(360);
    expect(jpMacroTarget()).toBe(360);
  });

  it("anchors JP's macroTarget at the modern rate in a 2019-era world", async () => {
    setupNeutralJP(106, 106);
    await processForexTurn(db as unknown as Db, 50, "2019-default");
    expect(jpMacroTarget()).toBe(INITIAL_RATES.JP);
  });

  it("defaults to the modern table when no preset is supplied (legacy worlds)", async () => {
    setupNeutralJP(106, 106);
    await processForexTurn(db as unknown as Db, 50);
    expect(jpMacroTarget()).toBe(INITIAL_RATES.JP);
  });
});

describe("currency pressure cycles", () => {
  function setUsRate(extra: Record<string, unknown>) {
    db.collectionMocks.exchangeRates.find.mockReturnValue({
      toArray: vi
        .fn()
        .mockResolvedValue([
          { ...makeExchangeRate("US", "USD", 1.0, 1.0), ...extra },
          makeExchangeRate("UK", "GBP", 0.75, 0.75),
          makeExchangeRate("JP", "JPY", 106.0, 106.0),
        ]),
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      project: vi.fn().mockReturnThis(),
    });
  }

  function usSet() {
    const usCall = db.collectionMocks.exchangeRates.updateOne.mock.calls.find(
      (call: Array<{ _id: string }>) => call[0]._id === "US"
    );
    return usCall![1].$set as {
      cyclePressureRegime: CurrencyCyclePressureRegime;
      cyclePressureUntilTurn: number;
    };
  }

  it("rolls and persists a regime (window = currentTurn + CYCLE_PRESSURE_TURNS) when none is active", async () => {
    await processForexTurn(db as unknown as Db, 50);
    const $set = usSet();
    expect(CYCLE_PRESSURE_REGIMES).toContain($set.cyclePressureRegime);
    expect($set.cyclePressureUntilTurn).toBe(50 + CYCLE_PRESSURE_TURNS);
  });

  it("keeps an active regime until its window expires", async () => {
    setUsRate({ cyclePressureRegime: "slight_weaken", cyclePressureUntilTurn: 60 });
    await processForexTurn(db as unknown as Db, 50); // 50 < 60 → unchanged
    const $set = usSet();
    expect($set.cyclePressureRegime).toBe("slight_weaken");
    expect($set.cyclePressureUntilTurn).toBe(60);
  });

  it("re-rolls when the window has elapsed", async () => {
    setUsRate({ cyclePressureRegime: "slight_weaken", cyclePressureUntilTurn: 50 });
    await processForexTurn(db as unknown as Db, 50); // 50 >= 50 → roll a fresh window
    const $set = usSet();
    expect($set.cyclePressureUntilTurn).toBe(50 + CYCLE_PRESSURE_TURNS);
  });
});
