/**
 * POST /api/forex/orders/[orderId]/fill — peer-fill another player's limit order
 * POST /api/forex/direct/[requestId]/accept|decline — direct trade requests
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import type { AuthWithCharacterResult } from "@/lib/api/requireAuth";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn(), getMongoClient: vi.fn() }));
vi.mock("@/lib/currency/featureFlag", () => ({
  isForexEnabled: vi.fn(),
}));
vi.mock("@/lib/api/requireAuth", () => ({
  requireAuthWithCharacter: vi.fn(),
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
vi.mock("@/lib/currency/spreadFees", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/currency/spreadFees")>();
  return {
    ...mod,
    distributeSpreadFee: vi.fn().mockResolvedValue({ destroyed: 0, toCentralBank: 0 }),
  };
});
// Direct-trade routes read the clock via getGameTime for the new-character barrier.
// currentTurn 100 + fixtures without createdTurn/createdAt → barrier never blocks here.
vi.mock("@/lib/time/gameTime", () => ({
  getGameTime: vi.fn().mockResolvedValue({ currentTurn: 100, effectiveNow: new Date() }),
}));

import { POST as POST_FILL_LIMIT_ORDER } from "../orders/[orderId]/fill/route";
import { DELETE as DELETE_LIMIT_ORDER } from "../orders/[orderId]/route";
import { POST as POST_DIRECT_TRADE_REQUEST } from "../direct/route";
import { POST as POST_DIRECT_TRADE } from "../direct/[requestId]/route";

let db: MockDb;

function primeCollections() {
  for (const name of [
    "currencyOrders",
    "characters",
    "gameState",
    "tradeHistory",
    "playerMail",
    "centralBanks",
  ]) {
    db.collection(name);
  }
}

beforeEach(() => {
  db = createMockDb();
});

async function setupDb() {
  primeCollections();
  const { getDb, getMongoClient } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as never);
  vi.mocked(getMongoClient).mockResolvedValue({
    startSession: () => ({
      withTransaction: vi.fn(async (callback: () => Promise<unknown>) => callback()),
      endSession: vi.fn(async () => {}),
    }),
  } as never);
}

function authOk(character: Record<string, unknown>): AuthWithCharacterResult {
  return {
    ok: true as const,
    user: { userId: "user-filler", character },
  } as unknown as AuthWithCharacterResult;
}

describe("POST /api/forex/orders/[orderId]/fill", () => {
  it("returns 403 when forex is disabled", async () => {
    await setupDb();
    const { isForexEnabled } = await import("@/lib/currency/featureFlag");
    vi.mocked(isForexEnabled).mockResolvedValue(false);

    const res = await POST_FILL_LIMIT_ORDER(
      new Request("http://localhost", { method: "POST", body: "{}" }),
      { params: Promise.resolve({ orderId: new ObjectId().toString() }) }
    );
    expect(res.status).toBeGreaterThanOrEqual(400);
    const json = await res.json();
    expect(json.error).toBeDefined();
  });

  it("returns 400 for invalid order id", async () => {
    await setupDb();
    const { isForexEnabled } = await import("@/lib/currency/featureFlag");
    vi.mocked(isForexEnabled).mockResolvedValue(true);
    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue(
      authOk({ _id: new ObjectId(), name: "F", countryId: "US" })
    );

    const res = await POST_FILL_LIMIT_ORDER(
      new Request("http://localhost", { method: "POST", body: "{}" }),
      { params: Promise.resolve({ orderId: "not-a-valid-oid" }) }
    );
    expect(res.status).toBe(400);
  });

  it("returns 403 when filler tries to fill their own order", async () => {
    await setupDb();
    const { isForexEnabled } = await import("@/lib/currency/featureFlag");
    vi.mocked(isForexEnabled).mockResolvedValue(true);

    const sameId = new ObjectId();
    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue(
      authOk({
        _id: sameId,
        name: "Self",
        countryId: "US",
        currencyBalances: { personal: { USD: 5000, GBP: 5000 } },
      })
    );

    db.collectionMocks.currencyOrders.findOne.mockResolvedValue({
      _id: new ObjectId(),
      type: "limit",
      status: "open",
      characterId: sameId,
      fromCurrency: "USD",
      toCurrency: "GBP",
      amount: 100,
      filledAmount: 0,
      limitRate: 0.8,
    });

    const res = await POST_FILL_LIMIT_ORDER(
      new Request("http://localhost", { method: "POST", body: "{}" }),
      { params: Promise.resolve({ orderId: new ObjectId().toString() }) }
    );
    expect(res.status).toBe(403);
  });

  it("returns 400 when order is not a limit order", async () => {
    await setupDb();
    const { isForexEnabled } = await import("@/lib/currency/featureFlag");
    vi.mocked(isForexEnabled).mockResolvedValue(true);
    const fillerId = new ObjectId();
    const posterId = new ObjectId();
    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue(
      authOk({
        _id: fillerId,
        name: "F",
        countryId: "US",
        currencyBalances: { personal: { GBP: 10_000 } },
      })
    );

    db.collectionMocks.currencyOrders.findOne.mockResolvedValue({
      _id: new ObjectId(),
      type: "direct",
      status: "open",
      characterId: posterId,
      fromCurrency: "USD",
      toCurrency: "GBP",
      amount: 100,
      filledAmount: 0,
      limitRate: 0.8,
    });

    const res = await POST_FILL_LIMIT_ORDER(
      new Request("http://localhost", { method: "POST", body: "{}" }),
      { params: Promise.resolve({ orderId: new ObjectId().toString() }) }
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 when filler lacks toCurrency for the trade", async () => {
    await setupDb();
    const { isForexEnabled } = await import("@/lib/currency/featureFlag");
    vi.mocked(isForexEnabled).mockResolvedValue(true);
    const fillerId = new ObjectId();
    const posterId = new ObjectId();
    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue(
      authOk({
        _id: fillerId,
        name: "Poor",
        countryId: "US",
        currencyBalances: { personal: { GBP: 1 } },
      })
    );

    db.collectionMocks.currencyOrders.findOne.mockResolvedValue({
      _id: new ObjectId(),
      type: "limit",
      status: "open",
      characterId: posterId,
      fromCurrency: "USD",
      toCurrency: "GBP",
      amount: 1000,
      filledAmount: 0,
      limitRate: 0.8,
    });

    const res = await POST_FILL_LIMIT_ORDER(
      new Request("http://localhost", { method: "POST", body: "{}" }),
      { params: Promise.resolve({ orderId: new ObjectId().toString() }) }
    );
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("Insufficient");
  });

  it("returns 200 and records fill when balances and updates succeed", async () => {
    await setupDb();
    const { isForexEnabled } = await import("@/lib/currency/featureFlag");
    vi.mocked(isForexEnabled).mockResolvedValue(true);

    const fillerId = new ObjectId();
    const posterId = new ObjectId();
    const orderId = new ObjectId();

    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue(
      authOk({
        _id: fillerId,
        name: "Filler",
        countryId: "US",
        currencyBalances: { personal: { USD: 0, GBP: 50_000 } },
      })
    );

    db.collectionMocks.currencyOrders.findOne.mockResolvedValue({
      _id: orderId,
      type: "limit",
      status: "open",
      characterId: posterId,
      fromCurrency: "USD",
      toCurrency: "GBP",
      amount: 100,
      filledAmount: 0,
      limitRate: 0.8,
    });

    db.collectionMocks.gameState.findOne.mockResolvedValue({ currentTurn: 51 });
    db.collectionMocks.characters.updateOne.mockResolvedValue({
      modifiedCount: 1,
      matchedCount: 1,
    });
    db.collectionMocks.currencyOrders.findOneAndUpdate.mockResolvedValue({
      _id: orderId,
      status: "open",
      filledAmount: 0,
    });
    db.collectionMocks.currencyOrders.updateOne.mockResolvedValue({
      modifiedCount: 1,
      matchedCount: 1,
    });
    db.collectionMocks.tradeHistory.insertOne.mockResolvedValue({ insertedId: new ObjectId() });

    const res = await POST_FILL_LIMIT_ORDER(
      new Request("http://localhost", { method: "POST", body: "{}" }),
      { params: Promise.resolve({ orderId: orderId.toString() }) }
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.filledAmount).toBe(100);
    expect(json.orderStatus).toBe("filled");
    expect(db.collectionMocks.tradeHistory.insertOne).toHaveBeenCalled();
  });
});

describe("DELETE /api/forex/orders/[orderId]", () => {
  it("does not refund twice when the cancellation claim loses the race", async () => {
    await setupDb();
    const { isForexEnabled } = await import("@/lib/currency/featureFlag");
    vi.mocked(isForexEnabled).mockResolvedValue(true);

    const ownerId = new ObjectId();
    const orderId = new ObjectId();
    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue(
      authOk({ _id: ownerId, name: "Poster", countryId: "US" })
    );

    db.collectionMocks.currencyOrders.findOne.mockResolvedValue({
      _id: orderId,
      type: "limit",
      status: "open",
      characterId: ownerId,
      fromCurrency: "USD",
      toCurrency: "GBP",
      amount: 500,
      filledAmount: 0,
    });
    db.collectionMocks.currencyOrders.findOneAndUpdate.mockResolvedValue(null);

    const res = await DELETE_LIMIT_ORDER(new Request("http://localhost", { method: "DELETE" }), {
      params: Promise.resolve({ orderId: orderId.toString() }),
    });

    expect(res.status).toBe(400);
    expect(db.collectionMocks.characters.updateOne).not.toHaveBeenCalled();
  });
});

describe("POST /api/forex/direct/[requestId]", () => {
  it("returns 403 when forex is disabled", async () => {
    await setupDb();
    const { isForexEnabled } = await import("@/lib/currency/featureFlag");
    vi.mocked(isForexEnabled).mockResolvedValue(false);

    const res = await POST_DIRECT_TRADE(
      new Request("http://localhost", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "decline" }),
      }),
      { params: Promise.resolve({ requestId: new ObjectId().toString() }) }
    );
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it("decline refunds sender and marks order cancelled", async () => {
    await setupDb();
    const { isForexEnabled } = await import("@/lib/currency/featureFlag");
    vi.mocked(isForexEnabled).mockResolvedValue(true);

    const targetId = new ObjectId();
    const senderId = new ObjectId();
    const reqId = new ObjectId();

    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue(
      authOk({
        _id: targetId,
        name: "Target",
        countryId: "US",
        sequentialId: 2,
      })
    );

    db.collectionMocks.currencyOrders.findOne.mockResolvedValue({
      _id: reqId,
      type: "direct",
      status: "open",
      characterId: senderId,
      characterName: "Sender",
      targetCharacterId: targetId,
      fromCurrency: "USD",
      toCurrency: "GBP",
      amount: 500,
      limitRate: 0.78,
    });

    db.collectionMocks.characters.findOne.mockResolvedValue({
      _id: senderId,
      userId: new ObjectId(),
      sequentialId: 1,
    });
    db.collectionMocks.currencyOrders.findOneAndUpdate.mockResolvedValue({
      _id: reqId,
      status: "open",
    });
    db.collectionMocks.currencyOrders.updateOne.mockResolvedValue({ modifiedCount: 1 });
    db.collectionMocks.characters.updateOne.mockResolvedValue({ modifiedCount: 1 });
    db.collectionMocks.playerMail.insertOne.mockResolvedValue({ insertedId: new ObjectId() });

    const res = await POST_DIRECT_TRADE(
      new Request("http://localhost", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "decline" }),
      }),
      { params: Promise.resolve({ requestId: reqId.toString() }) }
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.action).toBe("declined");

    expect(db.collectionMocks.characters.updateOne).toHaveBeenCalledWith(
      { _id: senderId },
      expect.objectContaining({
        $inc: expect.objectContaining({ "currencyBalances.personal.USD": 500 }),
      }),
      expect.anything()
    );
    expect(db.collectionMocks.playerMail.insertOne).toHaveBeenCalled();
  });

  it("decline does not refund twice when the order claim fails", async () => {
    await setupDb();
    const { isForexEnabled } = await import("@/lib/currency/featureFlag");
    vi.mocked(isForexEnabled).mockResolvedValue(true);

    const targetId = new ObjectId();
    const senderId = new ObjectId();
    const reqId = new ObjectId();

    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue(
      authOk({ _id: targetId, name: "Target", countryId: "US", sequentialId: 2 })
    );

    db.collectionMocks.currencyOrders.findOne.mockResolvedValue({
      _id: reqId,
      type: "direct",
      status: "open",
      characterId: senderId,
      characterName: "Sender",
      targetCharacterId: targetId,
      fromCurrency: "USD",
      toCurrency: "GBP",
      amount: 500,
      limitRate: 0.78,
    });
    db.collectionMocks.characters.findOne.mockResolvedValue({
      _id: senderId,
      userId: new ObjectId(),
      sequentialId: 1,
    });
    db.collectionMocks.currencyOrders.findOneAndUpdate.mockResolvedValue(null);

    const res = await POST_DIRECT_TRADE(
      new Request("http://localhost", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "decline" }),
      }),
      { params: Promise.resolve({ requestId: reqId.toString() }) }
    );
    expect(res.status).toBe(400);
    expect(db.collectionMocks.characters.updateOne).not.toHaveBeenCalled();
  });

  it("returns 403 when caller is not the trade target", async () => {
    await setupDb();
    const { isForexEnabled } = await import("@/lib/currency/featureFlag");
    vi.mocked(isForexEnabled).mockResolvedValue(true);

    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue(
      authOk({ _id: new ObjectId(), name: "Stranger", countryId: "US" })
    );

    db.collectionMocks.currencyOrders.findOne.mockResolvedValue({
      _id: new ObjectId(),
      type: "direct",
      status: "open",
      characterId: new ObjectId(),
      targetCharacterId: new ObjectId(),
      fromCurrency: "USD",
      toCurrency: "GBP",
      amount: 100,
      limitRate: 0.8,
    });

    const res = await POST_DIRECT_TRADE(
      new Request("http://localhost", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "decline" }),
      }),
      { params: Promise.resolve({ requestId: new ObjectId().toString() }) }
    );
    expect(res.status).toBe(403);
  });

  it("returns 400 on accept when target cannot cover toCurrency + spread", async () => {
    await setupDb();
    const { isForexEnabled } = await import("@/lib/currency/featureFlag");
    vi.mocked(isForexEnabled).mockResolvedValue(true);

    const targetId = new ObjectId();
    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue(
      authOk({
        _id: targetId,
        name: "Broke",
        countryId: "US",
        currencyBalances: { personal: { GBP: 1 } },
      })
    );

    db.collectionMocks.currencyOrders.findOne.mockResolvedValue({
      _id: new ObjectId(),
      type: "direct",
      status: "open",
      characterId: new ObjectId(),
      characterName: "Rich",
      targetCharacterId: targetId,
      fromCurrency: "USD",
      toCurrency: "GBP",
      amount: 1000,
      limitRate: 0.8,
    });

    const res = await POST_DIRECT_TRADE(
      new Request("http://localhost", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "accept" }),
      }),
      { params: Promise.resolve({ requestId: new ObjectId().toString() }) }
    );
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("Insufficient");
  });

  it("accept completes trade and writes history", async () => {
    await setupDb();
    const { isForexEnabled } = await import("@/lib/currency/featureFlag");
    vi.mocked(isForexEnabled).mockResolvedValue(true);

    const targetId = new ObjectId();
    const senderId = new ObjectId();
    const reqId = new ObjectId();

    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue(
      authOk({
        _id: targetId,
        name: "Target",
        countryId: "US",
        sequentialId: 3,
        currencyBalances: { personal: { GBP: 50_000, USD: 0 } },
      })
    );

    db.collectionMocks.currencyOrders.findOne.mockResolvedValue({
      _id: reqId,
      type: "direct",
      status: "open",
      characterId: senderId,
      characterName: "Sender",
      targetCharacterId: targetId,
      fromCurrency: "USD",
      toCurrency: "GBP",
      amount: 200,
      limitRate: 0.75,
    });

    db.collectionMocks.gameState.findOne.mockResolvedValue({ currentTurn: 12 });
    db.collectionMocks.currencyOrders.findOneAndUpdate.mockResolvedValue({
      _id: reqId,
      status: "open",
    });
    db.collectionMocks.characters.updateOne.mockResolvedValue({
      modifiedCount: 1,
      matchedCount: 1,
    });
    db.collectionMocks.currencyOrders.updateOne.mockResolvedValue({ modifiedCount: 1 });
    db.collectionMocks.tradeHistory.insertOne.mockResolvedValue({ insertedId: new ObjectId() });
    db.collectionMocks.characters.findOne.mockResolvedValue({
      _id: senderId,
      userId: new ObjectId(),
      sequentialId: 9,
    });
    db.collectionMocks.playerMail.insertOne.mockResolvedValue({ insertedId: new ObjectId() });

    const res = await POST_DIRECT_TRADE(
      new Request("http://localhost", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "accept" }),
      }),
      { params: Promise.resolve({ requestId: reqId.toString() }) }
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.action).toBe("accepted");
    expect(json.trade.fromCurrency).toBe("USD");
    expect(db.collectionMocks.tradeHistory.insertOne).toHaveBeenCalled();
  });

  it("accept reopens the order without crediting the sender when fallback debit fails", async () => {
    await setupDb();
    const { getMongoClient } = await import("@/lib/mongodb");
    vi.mocked(getMongoClient).mockResolvedValue({
      startSession: () => ({
        withTransaction: vi.fn(async () => {
          const err = new Error("no tx") as Error & { code?: number };
          err.code = 20;
          throw err;
        }),
        endSession: vi.fn(async () => {}),
      }),
    } as never);

    const { isForexEnabled } = await import("@/lib/currency/featureFlag");
    vi.mocked(isForexEnabled).mockResolvedValue(true);

    const targetId = new ObjectId();
    const senderId = new ObjectId();
    const reqId = new ObjectId();

    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue(
      authOk({
        _id: targetId,
        name: "Target",
        countryId: "US",
        sequentialId: 3,
        currencyBalances: { personal: { GBP: 50_000, USD: 0 } },
      })
    );

    db.collectionMocks.currencyOrders.findOne.mockResolvedValue({
      _id: reqId,
      type: "direct",
      status: "open",
      characterId: senderId,
      characterName: "Sender",
      targetCharacterId: targetId,
      fromCurrency: "USD",
      toCurrency: "GBP",
      amount: 200,
      limitRate: 0.75,
    });
    db.collectionMocks.gameState.findOne.mockResolvedValue({ currentTurn: 12 });
    db.collectionMocks.currencyOrders.findOneAndUpdate.mockResolvedValue({
      _id: reqId,
      status: "open",
    });
    db.collectionMocks.characters.updateOne
      .mockResolvedValueOnce({ modifiedCount: 0, matchedCount: 1 })
      .mockResolvedValue({ modifiedCount: 1, matchedCount: 1 });

    const res = await POST_DIRECT_TRADE(
      new Request("http://localhost", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "accept" }),
      }),
      { params: Promise.resolve({ requestId: reqId.toString() }) }
    );
    expect(res.status).toBe(400);
    expect(db.collectionMocks.characters.updateOne).toHaveBeenCalledTimes(1);
    expect(db.collectionMocks.currencyOrders.updateOne).toHaveBeenCalledWith(
      { _id: reqId, status: "processing" },
      expect.objectContaining({
        $set: expect.objectContaining({ status: "open" }),
      })
    );
  });

  it("blocks a new character (within the 24-turn barrier) from accepting with 403", async () => {
    await setupDb();
    const { isForexEnabled } = await import("@/lib/currency/featureFlag");
    vi.mocked(isForexEnabled).mockResolvedValue(true);

    const targetId = new ObjectId();
    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    // getGameTime mock reports currentTurn 100; createdTurn 90 → 14 turns remain.
    vi.mocked(requireAuthWithCharacter).mockResolvedValue(
      authOk({
        _id: targetId,
        name: "NewTarget",
        countryId: "US",
        currencyBalances: { personal: { GBP: 50_000 } },
        createdTurn: 90,
      })
    );

    db.collectionMocks.currencyOrders.findOne.mockResolvedValue({
      _id: new ObjectId(),
      type: "direct",
      status: "open",
      characterId: new ObjectId(),
      characterName: "Rich",
      targetCharacterId: targetId,
      fromCurrency: "USD",
      toCurrency: "GBP",
      amount: 1000,
      limitRate: 0.8,
    });

    const res = await POST_DIRECT_TRADE(
      new Request("http://localhost", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "accept" }),
      }),
      { params: Promise.resolve({ requestId: new ObjectId().toString() }) }
    );
    expect(res.status).toBe(403);
    expect(db.collectionMocks.characters.updateOne).not.toHaveBeenCalled();
  });

  it("still lets a new character decline (escrow must be returnable)", async () => {
    await setupDb();
    const { isForexEnabled } = await import("@/lib/currency/featureFlag");
    vi.mocked(isForexEnabled).mockResolvedValue(true);

    const targetId = new ObjectId();
    const senderId = new ObjectId();
    const reqId = new ObjectId();
    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue(
      authOk({ _id: targetId, name: "NewTarget", countryId: "US", createdTurn: 90 })
    );

    db.collectionMocks.currencyOrders.findOne.mockResolvedValue({
      _id: reqId,
      type: "direct",
      status: "open",
      characterId: senderId,
      characterName: "Sender",
      targetCharacterId: targetId,
      fromCurrency: "USD",
      toCurrency: "GBP",
      amount: 1000,
      limitRate: 0.8,
    });
    db.collectionMocks.currencyOrders.findOneAndUpdate.mockResolvedValue({
      _id: reqId,
      status: "open",
    });
    db.collectionMocks.characters.updateOne.mockResolvedValue({
      modifiedCount: 1,
      matchedCount: 1,
    });
    db.collectionMocks.currencyOrders.updateOne.mockResolvedValue({ matchedCount: 1 });
    db.collectionMocks.characters.findOne.mockResolvedValue({
      _id: senderId,
      userId: new ObjectId(),
    });
    db.collectionMocks.playerMail.insertOne.mockResolvedValue({ insertedId: new ObjectId() });

    const res = await POST_DIRECT_TRADE(
      new Request("http://localhost", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "decline" }),
      }),
      { params: Promise.resolve({ requestId: reqId.toString() }) }
    );
    expect(res.status).toBe(200);
  });
});

describe("POST /api/forex/direct", () => {
  it("refunds escrow when order creation fails after the debit", async () => {
    await setupDb();
    const { getMongoClient } = await import("@/lib/mongodb");
    vi.mocked(getMongoClient).mockResolvedValue({
      startSession: () => ({
        withTransaction: vi.fn(async () => {
          const err = new Error("no tx") as Error & { code?: number };
          err.code = 20;
          throw err;
        }),
        endSession: vi.fn(async () => {}),
      }),
    } as never);
    const { isForexEnabled } = await import("@/lib/currency/featureFlag");
    vi.mocked(isForexEnabled).mockResolvedValue(true);

    const senderId = new ObjectId();
    const targetId = new ObjectId();
    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue(
      authOk({
        _id: senderId,
        name: "Sender",
        countryId: "US",
        currencyBalances: { personal: { USD: 10_000 } },
      })
    );

    db.collectionMocks.characters.findOne.mockResolvedValue({
      _id: targetId,
      userId: new ObjectId(),
      name: "Target",
      sequentialId: 4,
    });
    db.collectionMocks.gameState.findOne.mockResolvedValue({ currentTurn: 33 });
    db.collectionMocks.characters.updateOne
      .mockResolvedValueOnce({ modifiedCount: 1, matchedCount: 1 })
      .mockResolvedValueOnce({ modifiedCount: 1, matchedCount: 1 });
    db.collectionMocks.currencyOrders.insertOne.mockRejectedValue(new Error("write failed"));

    const res = await POST_DIRECT_TRADE_REQUEST(
      new Request("http://localhost", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetCharacterId: targetId.toString(),
          fromCurrency: "USD",
          toCurrency: "GBP",
          amount: 500,
          proposedRate: 0.78,
        }),
      })
    );

    expect(res.status).toBeGreaterThanOrEqual(500);
    expect(db.collectionMocks.characters.updateOne).toHaveBeenNthCalledWith(
      2,
      { _id: senderId },
      expect.objectContaining({
        $inc: expect.objectContaining({ "currencyBalances.personal.USD": 500 }),
      })
    );
  });

  it("returns success even when the notification mail write fails", async () => {
    await setupDb();
    const { isForexEnabled } = await import("@/lib/currency/featureFlag");
    vi.mocked(isForexEnabled).mockResolvedValue(true);

    const senderId = new ObjectId();
    const targetId = new ObjectId();
    const createdOrderId = new ObjectId();
    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue(
      authOk({
        _id: senderId,
        name: "Sender",
        countryId: "US",
        sequentialId: 8,
        currencyBalances: { personal: { USD: 10_000 } },
      })
    );

    db.collectionMocks.characters.findOne.mockResolvedValue({
      _id: targetId,
      userId: new ObjectId(),
      name: "Target",
      sequentialId: 4,
    });
    db.collectionMocks.gameState.findOne.mockResolvedValue({ currentTurn: 33 });
    db.collectionMocks.characters.updateOne.mockResolvedValue({
      modifiedCount: 1,
      matchedCount: 1,
    });
    db.collectionMocks.currencyOrders.insertOne.mockResolvedValue({ insertedId: createdOrderId });
    db.collectionMocks.playerMail.insertOne.mockRejectedValue(new Error("mail down"));

    const res = await POST_DIRECT_TRADE_REQUEST(
      new Request("http://localhost", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetCharacterId: targetId.toString(),
          fromCurrency: "USD",
          toCurrency: "GBP",
          amount: 500,
          proposedRate: 0.78,
        }),
      })
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.notifiedTarget).toBe(false);
  });

  it("blocks a new character (within the 24-turn barrier) from initiating with 403", async () => {
    await setupDb();
    const { isForexEnabled } = await import("@/lib/currency/featureFlag");
    vi.mocked(isForexEnabled).mockResolvedValue(true);

    const senderId = new ObjectId();
    const targetId = new ObjectId();
    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    // getGameTime mock reports currentTurn 100; createdTurn 90 → 14 turns remain.
    vi.mocked(requireAuthWithCharacter).mockResolvedValue(
      authOk({
        _id: senderId,
        name: "NewSender",
        countryId: "US",
        currencyBalances: { personal: { USD: 10_000 } },
        createdTurn: 90,
      })
    );

    db.collectionMocks.characters.findOne.mockResolvedValue({
      _id: targetId,
      userId: new ObjectId(),
      name: "Target",
      sequentialId: 4,
    });

    const res = await POST_DIRECT_TRADE_REQUEST(
      new Request("http://localhost", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetCharacterId: targetId.toString(),
          fromCurrency: "USD",
          toCurrency: "GBP",
          amount: 500,
          proposedRate: 0.78,
        }),
      })
    );

    expect(res.status).toBe(403);
    expect(db.collectionMocks.characters.updateOne).not.toHaveBeenCalled();
  });
});
