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
  db = createMockDb();

  // Pre-initialize all collections that forexTurn accesses
  db.collection("centralBanks");
  db.collection("exchangeRates");
  db.collection("currencyOrders");
  db.collection("tradeHistory");
  db.collection("characters");

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

  it("expires orders and refunds escrowed funds", async () => {
    const { ObjectId } = await import("mongodb");
    const charId = new ObjectId();
    const orderId = new ObjectId();

    // Set up the expiry find to return two orders
    const expiringOrders = [
      {
        _id: orderId,
        characterId: charId,
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
      },
    ];

    // forexTurn invokes updateMany twice on currencyOrders:
    //   1) processTriggeredLimitOrders — stuck-order recovery (processing→open)
    //   2) expireStaleOrders — expiry transition (open/partial→expired)
    //      limitOrdersExpired is read from transitionResult.modifiedCount
    // Stack two `mockResolvedValueOnce` so the second one (expiry) returns 1.
    db.collectionMocks.currencyOrders.updateMany
      .mockResolvedValueOnce({ modifiedCount: 0 })
      .mockResolvedValueOnce({ modifiedCount: 1 });

    // The expiry find uses a separate find() call (second one after limit order scan)
    // Override the currencyOrders find mock to handle both calls
    let findCallCount = 0;
    db.collectionMocks.currencyOrders.find.mockImplementation(() => {
      findCallCount++;
      if (findCallCount === 1) {
        // First call: limit order scan (open limit orders sorted by createdAt)
        return {
          toArray: vi.fn().mockResolvedValue([]),
          sort: vi.fn().mockReturnValue({
            toArray: vi.fn().mockResolvedValue([]),
          }),
        };
      }
      // Second call: expiry scan (status: "expired", updatedAt: now)
      return {
        toArray: vi.fn().mockResolvedValue(expiringOrders),
        sort: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        skip: vi.fn().mockReturnThis(),
        project: vi.fn().mockReturnThis(),
      };
    });

    const result = await processForexTurn(db as unknown as Db, 50);
    expect(result.limitOrdersExpired).toBe(1);

    // Verify refund was issued via bulkWrite: 1000 - 200 = 800 USD refunded
    const charBulkCalls = db.collectionMocks.characters.bulkWrite.mock.calls;
    expect(charBulkCalls.length).toBeGreaterThan(0);
    const [ops] = charBulkCalls[0];
    const refundOp = ops.find(
      (op: {
        updateOne?: { filter?: { _id: unknown }; update?: { $inc?: Record<string, number> } };
      }) =>
        op.updateOne?.filter?._id === charId &&
        op.updateOne?.update?.$inc?.["currencyBalances.personal.USD"] === 800
    );
    expect(refundOp).toBeDefined();

    // Verify orders were transitioned in bulk by status + expiry filter
    // (atomic crash-safe pattern: filter→updateMany, not find→by-_id)
    expect(db.collectionMocks.currencyOrders.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        status: { $in: ["open", "partial"] },
        expiresAtTurn: { $lte: 50 },
      }),
      expect.objectContaining({
        $set: expect.objectContaining({ status: "expired" }),
      })
    );
  });

  it("stores triggered limit-order reserve spread fees in the collected currency", async () => {
    const { ObjectId } = await import("mongodb");
    const charId = new ObjectId();
    const orderId = new ObjectId();
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

    let findCallCount = 0;
    db.collectionMocks.currencyOrders.find.mockImplementation(() => {
      findCallCount++;
      if (findCallCount === 1) {
        return {
          sort: vi.fn().mockReturnValue({
            toArray: vi.fn().mockResolvedValue([order]),
          }),
          toArray: vi.fn().mockResolvedValue([order]),
        };
      }
      return {
        toArray: vi.fn().mockResolvedValue([]),
        sort: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        skip: vi.fn().mockReturnThis(),
        project: vi.fn().mockReturnThis(),
      };
    });

    const result = await processForexTurn(db as unknown as Db, 50);

    expect(result.limitOrdersFilled).toBe(1);
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
