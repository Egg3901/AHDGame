/**
 * Route tests for player-facing forex endpoints: rates, trades, orders, transactions.
 * Uses mocked DB + auth; exercises validation, feature gating, and response shapes.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import type { AuthWithCharacterResult } from "@/lib/api/requireAuth";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { FOREX_ACTIVE_COUNTRIES, COUNTRY_CURRENCY_MAP } from "@/lib/constants/currencies";
import type { Character } from "@/lib/db/types";

vi.mock("@/lib/mongodb", () => ({
  getDb: vi.fn(),
  getMongoClient: vi.fn(async () => ({
    startSession: () => ({
      withTransaction: vi.fn(async () => {
        const err = new Error("transactions not supported on standalone") as Error & {
          code?: number;
        };
        err.code = 20;
        throw err;
      }),
      endSession: vi.fn(async () => {}),
    }),
  })),
}));
vi.mock("@/lib/currency/featureFlag", () => ({
  isForexEnabled: vi.fn(),
}));
vi.mock("@/lib/api/requireAuth", () => ({
  requireAuthWithCharacter: vi.fn(),
  requireBasicAuth: vi.fn(),
}));
vi.mock("@/lib/api/userApiAuth", () => ({
  requireUserApiKey: vi.fn(),
}));
vi.mock("@/lib/financialTxLog/emit", () => ({
  emitTx: vi.fn(),
}));
vi.mock("@/lib/api/rateLimit", () => ({
  checkRateLimit: vi.fn().mockReturnValue({ ok: true }),
  rateLimitResponse: vi.fn(
    (retryAfter: number) =>
      new Response(JSON.stringify({ error: "Too many requests" }), {
        status: 429,
        headers: { "Retry-After": String(retryAfter) },
      })
  ),
}));

import { GET as GET_FOREX_RATES } from "../rates/route";
import { GET as GET_FOREX_MONETARY_POLICY } from "../monetary-policy/route";
import { GET as GET_FOREX_TRADES } from "../trades/route";
import { GET as GET_FOREX_ORDERS, POST as POST_FOREX_ORDERS } from "../orders/route";
import { GET as GET_FOREX_TRANSACTIONS } from "../transactions/route";
import { POST as POST_FOREX_EXCHANGE } from "../exchange/route";
import { POST as POST_V1_FOREX_EXCHANGE } from "../../v1/forex/exchange/route";
import { keyedInsertId } from "@/lib/db/nonAtomicMoneyFlow";

let db: MockDb;

/** MockDb only materializes collection mocks after db.collection(name) runs once. */
function primeForexCollections() {
  for (const name of [
    "exchangeRates",
    "gameState",
    "gameConfig",
    "users",
    "currencyOrders",
    "characters",
    "tradeHistory",
    "centralBanks",
    "nonAtomicMoneyFlowReceipts",
  ]) {
    db.collection(name);
  }
}

beforeEach(() => {
  db = createMockDb();
});

async function setupDb() {
  primeForexCollections();
  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as never);
}

describe("GET /api/forex/rates", () => {
  it("returns 403 when forex is disabled", async () => {
    await setupDb();
    const { isForexEnabled } = await import("@/lib/currency/featureFlag");
    vi.mocked(isForexEnabled).mockResolvedValue(false);

    const res = await GET_FOREX_RATES();
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toBeDefined();
  });

  it("returns rates and baseRates when forex is enabled", async () => {
    await setupDb();
    const { isForexEnabled } = await import("@/lib/currency/featureFlag");
    vi.mocked(isForexEnabled).mockResolvedValue(true);

    const toArray = vi.fn().mockResolvedValue([
      { currencyCode: "USD", rate: 1.0, baseRate: 1.0 },
      { currencyCode: "GBP", rate: 0.8, baseRate: 0.75 },
      { currencyCode: "JPY", rate: 110.0, baseRate: 106.0 },
    ]);
    db.collectionMocks.exchangeRates.find.mockReturnValue({
      toArray,
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      project: vi.fn().mockReturnThis(),
    });

    const res = await GET_FOREX_RATES();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.rates).toEqual({ USD: 1, GBP: 0.8, JPY: 110 });
    expect(json.baseRates).toEqual({ USD: 1, GBP: 0.75, JPY: 106 });
  });
});

describe("GET /api/forex/monetary-policy", () => {
  it("returns 403 when forex is disabled", async () => {
    await setupDb();
    const { isForexEnabled } = await import("@/lib/currency/featureFlag");
    vi.mocked(isForexEnabled).mockResolvedValue(false);

    const res = await GET_FOREX_MONETARY_POLICY();
    expect(res.status).toBe(403);
  });

  it("returns histories for US, UK, JP when forex is enabled", async () => {
    await setupDb();
    db.collection("centralBanks");
    const { isForexEnabled } = await import("@/lib/currency/featureFlag");
    vi.mocked(isForexEnabled).mockResolvedValue(true);

    const toArray = vi.fn().mockResolvedValue([
      {
        countryId: "US",
        primeRate: 5.25,
        interestRateHistory: [{ turn: 10, rate: 5.25 }],
        inflationHistory: [{ turn: 10, rate: 3.1 }],
        gdpGrowthHistory: [{ turn: 10, rate: 2.4 }],
      },
      {
        countryId: "UK",
        primeRate: 5.0,
        interestRateHistory: [{ turn: 10, rate: 5.0 }],
        inflationHistory: [{ turn: 10, rate: 4.0 }],
        gdpGrowthHistory: [{ turn: 10, rate: 1.2 }],
      },
      {
        countryId: "JP",
        primeRate: 0.1,
        interestRateHistory: [{ turn: 10, rate: 0.1 }],
        inflationHistory: [{ turn: 10, rate: 2.0 }],
        gdpGrowthHistory: [{ turn: 10, rate: 0.8 }],
      },
    ]);
    db.collectionMocks.centralBanks.find.mockReturnValue({
      project: vi.fn().mockReturnThis(),
      toArray,
    });

    const res = await GET_FOREX_MONETARY_POLICY();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.countries).toHaveLength(FOREX_ACTIVE_COUNTRIES.length);
    expect(json.countries.map((c: { currencyCode: string }) => c.currencyCode)).toEqual(
      FOREX_ACTIVE_COUNTRIES.map((c) => COUNTRY_CURRENCY_MAP[c])
    );
    expect(json.countries[0].inflationHistory[0]).toEqual({ turn: 10, value: 3.1 });
  });
});

describe("GET /api/forex/trades", () => {
  it("returns 403 when forex is disabled", async () => {
    await setupDb();
    const { isForexEnabled } = await import("@/lib/currency/featureFlag");
    vi.mocked(isForexEnabled).mockResolvedValue(false);

    const res = await GET_FOREX_TRADES();
    expect(res.status).toBe(403);
  });

  it("returns mapped public trades with names", async () => {
    await setupDb();
    const { isForexEnabled } = await import("@/lib/currency/featureFlag");
    vi.mocked(isForexEnabled).mockResolvedValue(true);

    db.collectionMocks.gameState.findOne.mockResolvedValue({ currentTurn: 100 });

    const tradeId = new ObjectId();
    const aggToArray = vi.fn().mockResolvedValue([
      {
        _id: tradeId,
        fromCurrency: "USD",
        toCurrency: "JPY",
        amount: 500,
        rate: 110,
        spread: 2,
        turn: 99,
        createdAt: new Date("2026-01-01T00:00:00Z"),
        buyerName: "Buyer One",
        sellerName: null,
      },
    ]);
    db.collectionMocks.tradeHistory.aggregate.mockReturnValue({ toArray: aggToArray });

    const res = await GET_FOREX_TRADES();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.trades).toHaveLength(1);
    expect(json.trades[0]._id).toBe(tradeId.toString());
    expect(json.trades[0].buyerName).toBe("Buyer One");
    expect(json.trades[0].sellerName).toBeNull();
    expect(aggToArray).toHaveBeenCalled();
  });
});

function mockAuthCharacter(character: Record<string, unknown>) {
  return {
    ok: true as const,
    user: {
      userId: "user-1",
      username: "test-user",
      email: "test@example.com",
      role: "user",
      hasCharacter: true as const,
      // Test-only partial character — routes only access the fields provided here
      character: character as unknown as Character,
    },
  } as unknown as AuthWithCharacterResult;
}

describe("GET /api/forex/orders", () => {
  it("returns 401 when not authenticated", async () => {
    await setupDb();
    const { isForexEnabled } = await import("@/lib/currency/featureFlag");
    vi.mocked(isForexEnabled).mockResolvedValue(true);
    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    });

    const res = await GET_FOREX_ORDERS(new Request("http://localhost/api/forex/orders"));
    expect(res.status).toBe(401);
  });

  it("returns open orders for the authenticated character", async () => {
    await setupDb();
    const { isForexEnabled } = await import("@/lib/currency/featureFlag");
    vi.mocked(isForexEnabled).mockResolvedValue(true);

    const charId = new ObjectId();
    const orderId = new ObjectId();
    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue(
      mockAuthCharacter({ _id: charId, name: "Pol", countryId: "US" })
    );

    const createdAt = new Date();
    db.collectionMocks.currencyOrders.find.mockReturnValue({
      sort: vi.fn().mockReturnValue({
        limit: vi.fn().mockReturnValue({
          toArray: vi.fn().mockResolvedValue([
            {
              _id: orderId,
              type: "limit",
              direction: "buy",
              fromCurrency: "USD",
              toCurrency: "GBP",
              amount: 1000,
              filledAmount: 0,
              limitRate: 0.8,
              filledRate: undefined,
              status: "open",
              spreadCharged: 0,
              expiresAtTurn: 120,
              createdAt,
              updatedAt: createdAt,
            },
          ]),
        }),
      }),
      toArray: vi.fn().mockResolvedValue([]),
      limit: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      project: vi.fn().mockReturnThis(),
    });

    const res = await GET_FOREX_ORDERS(new Request("http://localhost/api/forex/orders"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.orders).toHaveLength(1);
    expect(json.orders[0]._id).toBe(orderId.toString());
    expect(json.orders[0].fromCurrency).toBe("USD");
  });

  it("with view=history queries filled, cancelled, and expired orders (limit 100)", async () => {
    await setupDb();
    const { isForexEnabled } = await import("@/lib/currency/featureFlag");
    vi.mocked(isForexEnabled).mockResolvedValue(true);

    const charId = new ObjectId();
    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue(
      mockAuthCharacter({ _id: charId, name: "Pol", countryId: "US" })
    );

    const limitFn = vi.fn().mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });
    db.collectionMocks.currencyOrders.find.mockReturnValue({
      sort: vi.fn().mockReturnValue({
        limit: limitFn,
        toArray: vi.fn().mockResolvedValue([]),
      }),
      toArray: vi.fn().mockResolvedValue([]),
      limit: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      project: vi.fn().mockReturnThis(),
    });

    const res = await GET_FOREX_ORDERS(
      new Request("http://localhost/api/forex/orders?view=history")
    );
    expect(res.status).toBe(200);

    const findFilter = db.collectionMocks.currencyOrders.find.mock.calls[0][0] as {
      status: { $in: string[] };
    };
    expect(findFilter.status.$in.sort()).toEqual(["cancelled", "expired", "filled"].sort());
    expect(limitFn).toHaveBeenCalledWith(100);
  });
});

describe("POST /api/forex/orders", () => {
  it("returns 400 when from and to currency are the same", async () => {
    await setupDb();
    const { isForexEnabled } = await import("@/lib/currency/featureFlag");
    vi.mocked(isForexEnabled).mockResolvedValue(true);
    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue(
      mockAuthCharacter({ _id: new ObjectId(), name: "Pol", countryId: "US" })
    );

    const res = await POST_FOREX_ORDERS(
      new Request("http://localhost/api/forex/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fromCurrency: "USD",
          toCurrency: "USD",
          amount: 100,
          limitRate: 1,
        }),
      })
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 when balance is insufficient", async () => {
    await setupDb();
    const { isForexEnabled } = await import("@/lib/currency/featureFlag");
    vi.mocked(isForexEnabled).mockResolvedValue(true);

    const charId = new ObjectId();
    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue(
      mockAuthCharacter({
        _id: charId,
        name: "Pol",
        countryId: "US",
        currencyBalances: { personal: { USD: 50 } },
      })
    );

    db.collectionMocks.gameState.findOne.mockResolvedValue({ currentTurn: 10 });
    db.collectionMocks.characters.updateOne.mockResolvedValue({
      modifiedCount: 0,
      matchedCount: 0,
    });

    const res = await POST_FOREX_ORDERS(
      new Request("http://localhost/api/forex/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fromCurrency: "USD",
          toCurrency: "GBP",
          amount: 1000,
          limitRate: 0.75,
        }),
      })
    );
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("Insufficient");
  });

  it("escrows funds and inserts order on success", async () => {
    await setupDb();
    const { isForexEnabled } = await import("@/lib/currency/featureFlag");
    vi.mocked(isForexEnabled).mockResolvedValue(true);

    const charId = new ObjectId();
    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue(
      mockAuthCharacter({
        _id: charId,
        name: "Pol",
        countryId: "US",
        currencyBalances: { personal: { USD: 5000 } },
      })
    );

    db.collectionMocks.gameState.findOne.mockResolvedValue({ currentTurn: 10 });
    db.collectionMocks.characters.updateOne.mockResolvedValue({
      modifiedCount: 1,
      matchedCount: 1,
    });
    db.collectionMocks.currencyOrders.insertOne.mockResolvedValue({ insertedId: new ObjectId() });
    // The route reads the created row back by its deterministic key-derived id.
    const { keyedInsertId } = await import("@/lib/db/nonAtomicMoneyFlow");
    const expectedOrderId = keyedInsertId("order-key-1", "forex-order");
    const createdAt = new Date();
    db.collectionMocks.currencyOrders.findOne.mockResolvedValue({
      _id: expectedOrderId,
      characterId: charId,
      characterName: "Pol",
      countryId: "US",
      type: "limit",
      direction: "buy",
      fromCurrency: "USD",
      toCurrency: "JPY",
      amount: 2000,
      limitRate: 108,
      expiresAtTurn: 34,
      status: "open",
      filledAmount: 0,
      spreadCharged: 0,
      createdAt,
      updatedAt: createdAt,
    });

    const res = await POST_FOREX_ORDERS(
      new Request("http://localhost/api/forex/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": "order-key-1" },
        body: JSON.stringify({
          fromCurrency: "USD",
          toCurrency: "JPY",
          amount: 2000,
          limitRate: 108,
          expiresInTurns: 24,
        }),
      })
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    // Same key always rebuilds the same order id instead of opening a second order.
    expect(json.orderId).toBe(expectedOrderId.toHexString());

    // Crash-safe escrow: the debit is a keyed leg (balance guard + key guard
    // in one atomic write), not the legacy bare $gte update.
    expect(db.collectionMocks.characters.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({
        _id: charId,
        "currencyBalances.personal.USD": { $gte: 2000 },
        appliedMoneyFlowKeys: { $ne: "order-key-1" },
      }),
      expect.objectContaining({
        $inc: expect.objectContaining({ "currencyBalances.personal.USD": -2000 }),
      }),
      undefined
    );

    const insertCall = db.collectionMocks.currencyOrders.insertOne.mock.calls[0][0] as {
      _id: ObjectId;
      expiresAtTurn: number;
      limitRate: number;
    };
    expect(insertCall._id).toEqual(expectedOrderId);
    expect(insertCall.expiresAtTurn).toBe(34);
    expect(insertCall.limitRate).toBe(108);
  });

  it("compensates the escrow when order insertion fails after the debit", async () => {
    await setupDb();
    const { isForexEnabled } = await import("@/lib/currency/featureFlag");
    vi.mocked(isForexEnabled).mockResolvedValue(true);

    const charId = new ObjectId();
    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue(
      mockAuthCharacter({
        _id: charId,
        name: "Pol",
        countryId: "US",
        currencyBalances: { personal: { USD: 5000 } },
      })
    );

    db.collectionMocks.gameState.findOne.mockResolvedValue({ currentTurn: 10 });
    db.collectionMocks.characters.updateOne.mockResolvedValue({
      modifiedCount: 1,
      matchedCount: 1,
    });
    db.collectionMocks.currencyOrders.insertOne.mockRejectedValue(new Error("write failed"));

    const res = await POST_FOREX_ORDERS(
      new Request("http://localhost/api/forex/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": "order-key-2" },
        body: JSON.stringify({
          fromCurrency: "USD",
          toCurrency: "JPY",
          amount: 2000,
          limitRate: 108,
        }),
      })
    );

    expect(res.status).toBeGreaterThanOrEqual(500);
    // The failed insert reverses the applied escrow prefix with a
    // compensation leg (negated $inc under a compensation key), so the
    // receipt settles compensated instead of stranding the debit.
    const refundCall = db.collectionMocks.characters.updateOne.mock.calls[1];
    expect(refundCall[0]).toMatchObject({ _id: charId });
    expect(refundCall[1]).toMatchObject({
      $inc: { "currencyBalances.personal.USD": 2000 },
    });
    const receiptUpdate = db.collectionMocks.nonAtomicMoneyFlowReceipts.updateOne.mock.calls.find(
      (call) => (call[1] as { $set?: { status?: string } }).$set?.status === "compensated"
    );
    expect(receiptUpdate).toBeDefined();
  });
});

describe("GET /api/forex/transactions", () => {
  it("returns 401 when not authenticated", async () => {
    await setupDb();
    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    });

    const res = await GET_FOREX_TRANSACTIONS(
      new Request("http://localhost/api/forex/transactions")
    );
    expect(res.status).toBe(401);
  });

  it("returns empty buckets when no trade turns exist", async () => {
    await setupDb();
    const charId = new ObjectId();
    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue(
      mockAuthCharacter({ _id: charId, name: "Pol", countryId: "US" })
    );

    db.collectionMocks.tradeHistory.aggregate.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });

    const res = await GET_FOREX_TRANSACTIONS(
      new Request("http://localhost/api/forex/transactions")
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.turns).toEqual([]);
    expect(json.hasMore).toBe(false);
  });

  it("buckets individual trades by turn and enriches buyer name", async () => {
    await setupDb();
    const charId = new ObjectId();
    const otherId = new ObjectId();
    const tradeId = new ObjectId();
    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue(
      mockAuthCharacter({ _id: charId, name: "Self", countryId: "US", sequentialId: 7 })
    );

    let aggCalls = 0;
    db.collectionMocks.tradeHistory.aggregate.mockImplementation(() => {
      aggCalls++;
      if (aggCalls === 1) {
        return { toArray: vi.fn().mockResolvedValue([{ _id: 42 }]) };
      }
      return {
        toArray: vi.fn().mockResolvedValue([
          {
            _id: { turn: 42, source: "auto_coupon", fromCurrency: "USD", toCurrency: "GBP" },
            totalAmount: 1_000_000,
            totalSpread: 500,
            avgRate: 0.77,
            participantCount: 50,
          },
        ]),
      };
    });

    const createdAt = new Date("2026-04-10T12:00:00Z");
    db.collectionMocks.tradeHistory.find.mockReturnValue({
      sort: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([
          {
            _id: tradeId,
            turn: 42,
            fromCurrency: "GBP",
            toCurrency: "USD",
            amount: 100,
            rate: 1.08,
            spread: 1,
            source: "manual",
            sourceRef: null,
            buyerCharacterId: charId,
            sellerCharacterId: otherId,
            createdAt,
          },
        ]),
      }),
      limit: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      project: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([]),
    });

    db.collectionMocks.characters.find.mockReturnValue({
      project: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([
          { _id: charId, name: "Self", sequentialId: 7 },
          { _id: otherId, name: "Counterparty", sequentialId: 3 },
        ]),
      }),
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([]),
    });

    const res = await GET_FOREX_TRANSACTIONS(
      new Request("http://localhost/api/forex/transactions?turns=1&offset=0")
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.turns).toHaveLength(1);
    expect(json.turns[0].turn).toBe(42);
    const items = json.turns[0].items as Array<{ kind: string }>;
    const summary = items.find((i) => i.kind === "summary");
    const row = items.find((i) => i.kind === "row");
    expect(summary).toMatchObject({
      kind: "summary",
      source: "auto_coupon",
      totalAmount: 1_000_000,
    });
    expect(row).toMatchObject({
      kind: "row",
      fromCurrency: "GBP",
      isBuyer: true,
      traderName: "Self",
    });
  });

  it("scope=mine skips global auto-income summaries and returns only matching rows", async () => {
    await setupDb();
    const charId = new ObjectId();
    const tradeId = new ObjectId();
    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue(
      mockAuthCharacter({ _id: charId, name: "Self", countryId: "US" })
    );

    let aggCalls = 0;
    db.collectionMocks.tradeHistory.aggregate.mockImplementation(() => {
      aggCalls++;
      if (aggCalls === 1) {
        return { toArray: vi.fn().mockResolvedValue([{ _id: 5 }]) };
      }
      throw new Error("aggregate should not run for auto summary when scope=mine");
    });

    db.collectionMocks.tradeHistory.find.mockReturnValue({
      sort: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([
          {
            _id: tradeId,
            turn: 5,
            fromCurrency: "USD",
            toCurrency: "JPY",
            amount: 50,
            rate: 107,
            spread: 0.5,
            source: "auto_dividend",
            sourceRef: null,
            buyerCharacterId: charId,
            sellerCharacterId: null,
            createdAt: new Date(),
          },
        ]),
      }),
      limit: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      project: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([]),
    });

    db.collectionMocks.characters.find.mockReturnValue({
      project: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([{ _id: charId, name: "Self", sequentialId: 1 }]),
      }),
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([]),
    });

    const res = await GET_FOREX_TRANSACTIONS(
      new Request("http://localhost/api/forex/transactions?scope=mine&turns=1")
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    const items = json.turns[0].items as Array<{ kind: string; source?: string }>;
    expect(items.every((i) => i.kind === "row")).toBe(true);
    expect(items[0].source).toBe("auto_dividend");
  });
});

describe("POST /api/forex/exchange (Idempotency-Key)", () => {
  /** Programs every read/write the market-maker trade needs on the mock Db. */
  function primeExchangeSuccess(userId: ObjectId, charId: ObjectId) {
    db.collectionMocks.gameState.findOne.mockResolvedValue({ currentTurn: 100 });
    db.collectionMocks.gameConfig.findOne.mockResolvedValue({});
    db.collectionMocks.users.findOne.mockResolvedValue({
      _id: userId,
      activeCharacterId: charId,
    });
    db.collectionMocks.characters.findOne.mockResolvedValue({
      _id: charId,
      countryId: "US",
      name: "Trader",
      currencyBalances: { personal: { USD: 1_000_000 } },
    });
    db.collectionMocks.exchangeRates.findOne.mockImplementation((filter: { _id: string }) => {
      if (filter._id === "US") {
        return Promise.resolve({
          _id: "US",
          countryId: "US",
          currencyCode: "USD",
          rate: 1.0,
        });
      }
      if (filter._id === "JP") {
        return Promise.resolve({
          _id: "JP",
          countryId: "JP",
          currencyCode: "JPY",
          rate: 106.0,
        });
      }
      return Promise.resolve(null);
    });
    db.collectionMocks.characters.updateOne.mockResolvedValue({
      matchedCount: 1,
      modifiedCount: 1,
    });
    db.collectionMocks.tradeHistory.insertOne.mockResolvedValue({ insertedId: new ObjectId() });
    db.collectionMocks.centralBanks.updateOne.mockResolvedValue({
      matchedCount: 1,
      modifiedCount: 1,
    });
  }

  function exchangeReq(key?: string) {
    return POST_FOREX_EXCHANGE(
      new Request("http://localhost/api/forex/exchange", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(key !== undefined ? { "Idempotency-Key": key } : {}),
        },
        body: JSON.stringify({ fromCurrency: "USD", toCurrency: "JPY", amount: 1000 }),
      })
    );
  }

  it("returns 403 when forex is disabled", async () => {
    await setupDb();
    const { isForexEnabled } = await import("@/lib/currency/featureFlag");
    vi.mocked(isForexEnabled).mockResolvedValue(false);

    expect((await exchangeReq()).status).toBe(403);
  });

  it("replays the stored trade on a same-key retry: 200 twice, one trade", async () => {
    await setupDb();
    const { isForexEnabled } = await import("@/lib/currency/featureFlag");
    vi.mocked(isForexEnabled).mockResolvedValue(true);

    const userId = new ObjectId();
    const charId = new ObjectId();
    const key = "exchange-key-replay";
    const { requireBasicAuth } = await import("@/lib/api/requireAuth");
    vi.mocked(requireBasicAuth).mockResolvedValue({
      ok: true as const,
      user: { userId: userId.toHexString() },
    } as never);
    primeExchangeSuccess(userId, charId);

    const { emitTx: emitTxWeb } = await import("@/lib/financialTxLog/emit");
    const emitBeforeWeb = vi.mocked(emitTxWeb).mock.calls.length;

    const first = await exchangeReq(key);
    expect(first.status).toBe(200);
    const firstJson = await first.json();
    expect(firstJson).toMatchObject({
      success: true,
      trade: { fromCurrency: "USD", toCurrency: "JPY", fromAmount: 1000 },
    });
    const walletWritesAfterFirst = db.collectionMocks.characters.updateOne.mock.calls.length;

    // Same key hits the completed receipt: the stored history row replays the
    // trade, and neither the wallet nor the history nor the money log moves.
    const storedTrade = db.collectionMocks.tradeHistory.insertOne.mock.calls[0][0];
    expect(storedTrade._id).toEqual(keyedInsertId(key, "forex-trade"));
    db.collectionMocks.tradeHistory.findOne.mockResolvedValue(storedTrade);
    db.collectionMocks.nonAtomicMoneyFlowReceipts.insertOne.mockRejectedValue(
      Object.assign(new Error("E11000 duplicate key"), { code: 11000 })
    );
    db.collectionMocks.nonAtomicMoneyFlowReceipts.findOne.mockResolvedValue({
      _id: key,
      status: "completed",
      fingerprint: `forex-market:${charId.toHexString()}:characters:USD:JPY:1000`,
    });

    const second = await exchangeReq(key);
    expect(second.status).toBe(200);
    const secondJson = await second.json();
    expect(secondJson.trade).toEqual(firstJson.trade);
    expect(db.collectionMocks.characters.updateOne.mock.calls.length).toBe(walletWritesAfterFirst);
    expect(db.collectionMocks.tradeHistory.insertOne).toHaveBeenCalledTimes(1);
    const { emitTx } = await import("@/lib/financialTxLog/emit");
    // Only the first attempt logs: the replay returns the stored trade, and
    // the money log row from the first attempt already stands.
    expect(vi.mocked(emitTx).mock.calls.length).toBe(emitBeforeWeb + 1);
  });

  it("returns 400 for an over-long Idempotency-Key without trading", async () => {
    await setupDb();
    const { isForexEnabled } = await import("@/lib/currency/featureFlag");
    vi.mocked(isForexEnabled).mockResolvedValue(true);

    const userId = new ObjectId();
    const charId = new ObjectId();
    const { requireBasicAuth } = await import("@/lib/api/requireAuth");
    vi.mocked(requireBasicAuth).mockResolvedValue({
      ok: true as const,
      user: { userId: userId.toHexString() },
    } as never);
    primeExchangeSuccess(userId, charId);

    expect((await exchangeReq("k".repeat(129))).status).toBe(400);
    expect(db.collectionMocks.characters.updateOne).not.toHaveBeenCalled();
    expect(db.collectionMocks.tradeHistory.insertOne).not.toHaveBeenCalled();
  });
});

describe("POST /api/v1/forex/exchange (Idempotency-Key)", () => {
  function primeV1ExchangeSuccess(userId: ObjectId, charId: ObjectId) {
    db.collectionMocks.gameState.findOne.mockResolvedValue({ currentTurn: 100 });
    db.collectionMocks.gameConfig.findOne.mockResolvedValue({});
    db.collectionMocks.users.findOne.mockResolvedValue({
      _id: userId,
      activeCharacterId: charId,
    });
    db.collectionMocks.characters.findOne.mockResolvedValue({
      _id: charId,
      countryId: "US",
      name: "Trader",
      currencyBalances: { personal: { USD: 1_000_000 } },
    });
    db.collectionMocks.exchangeRates.findOne.mockImplementation((filter: { _id: string }) => {
      if (filter._id === "US") {
        return Promise.resolve({
          _id: "US",
          countryId: "US",
          currencyCode: "USD",
          rate: 1.0,
        });
      }
      if (filter._id === "JP") {
        return Promise.resolve({
          _id: "JP",
          countryId: "JP",
          currencyCode: "JPY",
          rate: 106.0,
        });
      }
      return Promise.resolve(null);
    });
    db.collectionMocks.characters.updateOne.mockResolvedValue({
      matchedCount: 1,
      modifiedCount: 1,
    });
    db.collectionMocks.tradeHistory.insertOne.mockResolvedValue({ insertedId: new ObjectId() });
    db.collectionMocks.centralBanks.updateOne.mockResolvedValue({
      matchedCount: 1,
      modifiedCount: 1,
    });
  }

  function v1ExchangeReq(key?: string) {
    return POST_V1_FOREX_EXCHANGE(
      new Request("http://localhost/api/v1/forex/exchange", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": "ahd_priv_test",
          ...(key !== undefined ? { "Idempotency-Key": key } : {}),
        },
        body: JSON.stringify({ fromCurrency: "USD", toCurrency: "JPY", amount: 1000 }),
      })
    );
  }

  it("replays the stored trade on a same-key retry: 200 twice, one trade", async () => {
    await setupDb();
    const { isForexEnabled } = await import("@/lib/currency/featureFlag");
    vi.mocked(isForexEnabled).mockResolvedValue(true);

    const userId = new ObjectId();
    const charId = new ObjectId();
    const key = "v1-exchange-key-replay";
    const { requireUserApiKey } = await import("@/lib/api/userApiAuth");
    vi.mocked(requireUserApiKey).mockResolvedValue({
      ok: true as const,
      ownerUserId: userId.toHexString(),
    } as never);
    primeV1ExchangeSuccess(userId, charId);

    const { emitTx: emitTxV1 } = await import("@/lib/financialTxLog/emit");
    const emitBeforeV1 = vi.mocked(emitTxV1).mock.calls.length;

    const first = await v1ExchangeReq(key);
    expect(first.status).toBe(200);
    const firstJson = await first.json();
    expect(firstJson).toMatchObject({
      success: true,
      trade: { fromCurrency: "USD", toCurrency: "JPY", fromAmount: 1000 },
    });
    const walletWritesAfterFirst = db.collectionMocks.characters.updateOne.mock.calls.length;

    const storedTrade = db.collectionMocks.tradeHistory.insertOne.mock.calls[0][0];
    expect(storedTrade._id).toEqual(keyedInsertId(key, "forex-trade"));
    db.collectionMocks.tradeHistory.findOne.mockResolvedValue(storedTrade);
    db.collectionMocks.nonAtomicMoneyFlowReceipts.insertOne.mockRejectedValue(
      Object.assign(new Error("E11000 duplicate key"), { code: 11000 })
    );
    db.collectionMocks.nonAtomicMoneyFlowReceipts.findOne.mockResolvedValue({
      _id: key,
      status: "completed",
      fingerprint: `forex-market:${charId.toHexString()}:characters:USD:JPY:1000`,
    });

    const second = await v1ExchangeReq(key);
    expect(second.status).toBe(200);
    const secondJson = await second.json();
    expect(secondJson.trade).toEqual(firstJson.trade);
    expect(db.collectionMocks.characters.updateOne.mock.calls.length).toBe(walletWritesAfterFirst);
    expect(db.collectionMocks.tradeHistory.insertOne).toHaveBeenCalledTimes(1);
    const { emitTx } = await import("@/lib/financialTxLog/emit");
    expect(vi.mocked(emitTx).mock.calls.length).toBe(emitBeforeV1 + 1);
  });

  it("returns 400 for an over-long Idempotency-Key without trading", async () => {
    await setupDb();
    const { isForexEnabled } = await import("@/lib/currency/featureFlag");
    vi.mocked(isForexEnabled).mockResolvedValue(true);

    const userId = new ObjectId();
    const charId = new ObjectId();
    const { requireUserApiKey } = await import("@/lib/api/userApiAuth");
    vi.mocked(requireUserApiKey).mockResolvedValue({
      ok: true as const,
      ownerUserId: userId.toHexString(),
    } as never);
    primeV1ExchangeSuccess(userId, charId);

    expect((await v1ExchangeReq("k".repeat(129))).status).toBe(400);
    expect(db.collectionMocks.characters.updateOne).not.toHaveBeenCalled();
    expect(db.collectionMocks.tradeHistory.insertOne).not.toHaveBeenCalled();
  });
});
