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
// Direct-trade routes read the clock via getGameTime for the new-character barrier.
// currentTurn 100 + fixtures without createdTurn/createdAt → barrier never blocks here.
vi.mock("@/lib/time/gameTime", () => ({
  getGameTime: vi.fn().mockResolvedValue({ currentTurn: 100, effectiveNow: new Date() }),
}));

import { POST as POST_FILL_LIMIT_ORDER } from "../orders/[orderId]/fill/route";
import { DELETE as DELETE_LIMIT_ORDER } from "../orders/[orderId]/route";
import { POST as POST_DIRECT_TRADE_REQUEST } from "../direct/route";
import { POST as POST_DIRECT_TRADE } from "../direct/[requestId]/route";
import { keyedInsertId } from "@/lib/db/nonAtomicMoneyFlow";

let db: MockDb;

function primeCollections() {
  for (const name of [
    "currencyOrders",
    "characters",
    "gameState",
    "tradeHistory",
    "playerMail",
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
    // The fill pre-checks the taker's live balance inside the primitive.
    db.collectionMocks.characters.findOne.mockResolvedValue({
      _id: fillerId,
      currencyBalances: { personal: { USD: 0, GBP: 50_000 } },
    });
    db.collectionMocks.characters.updateOne.mockResolvedValue({
      modifiedCount: 1,
      matchedCount: 1,
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
  it("loses cleanly when a concurrent fill wins the order race: 400, no refund", async () => {
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
    // A concurrent fill's transition commits first: the cancel's guarded
    // order step matches nothing, disambiguates to guard-rejected (the row
    // exists without this key), and settles failed with nothing applied.
    db.collectionMocks.currencyOrders.updateOne.mockResolvedValue({
      modifiedCount: 0,
      matchedCount: 0,
    });

    const res = await DELETE_LIMIT_ORDER(new Request("http://localhost", { method: "DELETE" }), {
      params: Promise.resolve({ orderId: orderId.toString() }),
    });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/open or partial/);
    expect(db.collectionMocks.characters.updateOne).not.toHaveBeenCalled();
  });

  it("cancels an open order and refunds the full escrow exactly once", async () => {
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
    db.collectionMocks.currencyOrders.updateOne.mockResolvedValue({
      modifiedCount: 1,
      matchedCount: 1,
    });
    db.collectionMocks.characters.updateOne.mockResolvedValue({
      modifiedCount: 1,
      matchedCount: 1,
    });

    const res = await DELETE_LIMIT_ORDER(
      new Request("http://localhost", {
        method: "DELETE",
        headers: { "Idempotency-Key": "cancel-key-1" },
      }),
      { params: Promise.resolve({ orderId: orderId.toString() }) }
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toMatchObject({
      success: true,
      refundedAmount: 500,
      refundedCurrency: "USD",
    });
    // The guarded cancel transition carries the flow key.
    expect(db.collectionMocks.currencyOrders.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({
        _id: orderId,
        appliedMoneyFlowKeys: { $ne: "cancel-key-1" },
      }),
      expect.objectContaining({ $set: expect.objectContaining({ status: "cancelled" }) }),
      expect.anything()
    );
    // The escrow refund is a keyed leg for the full remainder.
    expect(db.collectionMocks.characters.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({
        _id: ownerId,
        appliedMoneyFlowKeys: { $ne: "cancel-key-1" },
      }),
      expect.objectContaining({
        $inc: expect.objectContaining({ "currencyBalances.personal.USD": 500 }),
      }),
      expect.anything()
    );
  });

  it("replays the stored refund on a same-key retry: 200 twice, refund applied once", async () => {
    await setupDb();
    const { isForexEnabled } = await import("@/lib/currency/featureFlag");
    vi.mocked(isForexEnabled).mockResolvedValue(true);

    const ownerId = new ObjectId();
    const orderId = new ObjectId();
    const key = "cancel-key-replay";
    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue(
      authOk({ _id: ownerId, name: "Poster", countryId: "US" })
    );

    // Route pre-read plus primitive reads always see the same open row here;
    // the receipt claim is what distinguishes first attempt from replay.
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
    db.collectionMocks.currencyOrders.updateOne.mockResolvedValue({
      modifiedCount: 1,
      matchedCount: 1,
    });
    db.collectionMocks.characters.updateOne.mockResolvedValue({
      modifiedCount: 1,
      matchedCount: 1,
    });

    const cancelReq = () =>
      DELETE_LIMIT_ORDER(
        new Request("http://localhost", {
          method: "DELETE",
          headers: { "Idempotency-Key": key },
        }),
        { params: Promise.resolve({ orderId: orderId.toString() }) }
      );

    const first = await cancelReq();
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({
      success: true,
      refundedAmount: 500,
      refundedCurrency: "USD",
    });
    const writesAfterFirst = db.collectionMocks.characters.updateOne.mock.calls.length;

    // Second attempt with the same key hits the completed receipt and replays
    // the stored refund from the order row without moving money again.
    db.collectionMocks.nonAtomicMoneyFlowReceipts.insertOne.mockRejectedValue(
      Object.assign(new Error("E11000 duplicate key"), { code: 11000 })
    );
    db.collectionMocks.nonAtomicMoneyFlowReceipts.findOne.mockResolvedValue({
      _id: key,
      status: "completed",
      fingerprint: `forex-cancel:${orderId.toHexString()}:${ownerId.toHexString()}`,
    });

    const second = await cancelReq();
    expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject({
      success: true,
      refundedAmount: 500,
      refundedCurrency: "USD",
    });
    expect(db.collectionMocks.characters.updateOne.mock.calls.length).toBe(writesAfterFirst);
  });

  it("returns 400 for an over-long Idempotency-Key without touching the order", async () => {
    await setupDb();
    const { isForexEnabled } = await import("@/lib/currency/featureFlag");
    vi.mocked(isForexEnabled).mockResolvedValue(true);

    const ownerId = new ObjectId();
    const orderId = new ObjectId();
    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue(
      authOk({ _id: ownerId, name: "Poster", countryId: "US" })
    );

    // The route loads and authorizes the order before it validates the key.
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

    const res = await DELETE_LIMIT_ORDER(
      new Request("http://localhost", {
        method: "DELETE",
        headers: { "Idempotency-Key": "k".repeat(129) },
      }),
      { params: Promise.resolve({ orderId: orderId.toString() }) }
    );

    expect(res.status).toBe(400);
    expect(db.collectionMocks.currencyOrders.updateOne).not.toHaveBeenCalled();
    expect(db.collectionMocks.characters.updateOne).not.toHaveBeenCalled();
  });

  it("returns 409 when the key was already used for a different cancellation", async () => {
    await setupDb();
    const { isForexEnabled } = await import("@/lib/currency/featureFlag");
    vi.mocked(isForexEnabled).mockResolvedValue(true);

    const ownerId = new ObjectId();
    const orderId = new ObjectId();
    const key = "cancel-key-conflict";
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
    db.collectionMocks.nonAtomicMoneyFlowReceipts.insertOne.mockRejectedValue(
      Object.assign(new Error("E11000 duplicate key"), { code: 11000 })
    );
    db.collectionMocks.nonAtomicMoneyFlowReceipts.findOne.mockResolvedValue({
      _id: key,
      status: "completed",
      fingerprint: "forex-cancel:some-other-order:some-other-owner",
    });

    const res = await DELETE_LIMIT_ORDER(
      new Request("http://localhost", {
        method: "DELETE",
        headers: { "Idempotency-Key": key },
      }),
      { params: Promise.resolve({ orderId: orderId.toString() }) }
    );

    expect(res.status).toBe(409);
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
      filledAmount: 0,
      spreadCharged: 0,
      limitRate: 0.78,
    });

    db.collectionMocks.characters.findOne.mockResolvedValue({
      _id: senderId,
      userId: new ObjectId(),
      sequentialId: 1,
    });
    db.collectionMocks.currencyOrders.updateOne.mockResolvedValue({
      modifiedCount: 1,
      matchedCount: 1,
    });
    db.collectionMocks.characters.updateOne.mockResolvedValue({
      modifiedCount: 1,
      matchedCount: 1,
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
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.action).toBe("declined");

    // The decline refunds the sender's full escrow through a keyed leg.
    expect(db.collectionMocks.characters.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ _id: senderId }),
      expect.objectContaining({
        $inc: expect.objectContaining({ "currencyBalances.personal.USD": 500 }),
      }),
      expect.anything()
    );
    expect(db.collectionMocks.playerMail.insertOne).toHaveBeenCalled();
  });

  it("decline replays on a same-key retry: 200 twice, refund and mail once each", async () => {
    await setupDb();
    const { isForexEnabled } = await import("@/lib/currency/featureFlag");
    vi.mocked(isForexEnabled).mockResolvedValue(true);

    const targetId = new ObjectId();
    const senderId = new ObjectId();
    const reqId = new ObjectId();
    const key = "decline-key-replay";

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
      filledAmount: 0,
      spreadCharged: 0,
      limitRate: 0.78,
    });
    db.collectionMocks.characters.findOne.mockResolvedValue({
      _id: senderId,
      userId: new ObjectId(),
      sequentialId: 1,
    });
    db.collectionMocks.currencyOrders.updateOne.mockResolvedValue({
      modifiedCount: 1,
      matchedCount: 1,
    });
    db.collectionMocks.characters.updateOne.mockResolvedValue({
      modifiedCount: 1,
      matchedCount: 1,
    });
    db.collectionMocks.playerMail.insertOne.mockResolvedValue({ insertedId: new ObjectId() });

    const declineReq = () =>
      POST_DIRECT_TRADE(
        new Request("http://localhost", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Idempotency-Key": key },
          body: JSON.stringify({ action: "decline" }),
        }),
        { params: Promise.resolve({ requestId: reqId.toString() }) }
      );

    const first = await declineReq();
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ success: true, action: "declined" });
    const writesAfterFirst = db.collectionMocks.characters.updateOne.mock.calls.length;

    // Same key hits the completed receipt: the stored outcome replays from
    // the order row, and the route skips both the refund and the mail.
    db.collectionMocks.nonAtomicMoneyFlowReceipts.insertOne.mockRejectedValue(
      Object.assign(new Error("E11000 duplicate key"), { code: 11000 })
    );
    db.collectionMocks.nonAtomicMoneyFlowReceipts.findOne.mockResolvedValue({
      _id: key,
      status: "completed",
      fingerprint: `forex-decline:${reqId.toHexString()}:${targetId.toHexString()}`,
    });

    const second = await declineReq();
    expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject({ success: true, action: "declined" });
    expect(db.collectionMocks.characters.updateOne.mock.calls.length).toBe(writesAfterFirst);
    expect(db.collectionMocks.playerMail.insertOne).toHaveBeenCalledTimes(1);
  });

  it("decline returns 400 for an over-long Idempotency-Key without refunding", async () => {
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
      filledAmount: 0,
      spreadCharged: 0,
      limitRate: 0.78,
    });

    const res = await POST_DIRECT_TRADE(
      new Request("http://localhost", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": "k".repeat(129) },
        body: JSON.stringify({ action: "decline" }),
      }),
      { params: Promise.resolve({ requestId: reqId.toString() }) }
    );

    expect(res.status).toBe(400);
    expect(db.collectionMocks.characters.updateOne).not.toHaveBeenCalled();
    expect(db.collectionMocks.playerMail.insertOne).not.toHaveBeenCalled();
  });

  it("decline loses cleanly when a concurrent accept wins the race: 400, no refund", async () => {
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
      filledAmount: 0,
      spreadCharged: 0,
      limitRate: 0.78,
    });
    db.collectionMocks.characters.findOne.mockResolvedValue({
      _id: senderId,
      userId: new ObjectId(),
      sequentialId: 1,
    });
    // The accept's transition commits first: the decline's guarded cancel
    // step matches nothing and the receipt settles failed with no refund.
    db.collectionMocks.currencyOrders.updateOne.mockResolvedValue({
      modifiedCount: 0,
      matchedCount: 0,
    });

    const res = await POST_DIRECT_TRADE(
      new Request("http://localhost", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "decline" }),
      }),
      { params: Promise.resolve({ requestId: reqId.toString() }) }
    );
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/no longer open/);
    expect(db.collectionMocks.characters.updateOne).not.toHaveBeenCalled();
    expect(db.collectionMocks.playerMail.insertOne).not.toHaveBeenCalled();
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
      filledAmount: 0,
      spreadCharged: 0,
      limitRate: 0.8,
    });
    // The accept pre-checks the target's live balance inside the primitive.
    db.collectionMocks.characters.findOne.mockResolvedValue({
      _id: targetId,
      currencyBalances: { personal: { GBP: 1 } },
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
      filledAmount: 0,
      spreadCharged: 0,
      limitRate: 0.75,
    });

    db.collectionMocks.gameState.findOne.mockResolvedValue({ currentTurn: 12 });
    db.collectionMocks.characters.updateOne.mockResolvedValue({
      modifiedCount: 1,
      matchedCount: 1,
    });
    db.collectionMocks.currencyOrders.updateOne.mockResolvedValue({
      modifiedCount: 1,
      matchedCount: 1,
    });
    db.collectionMocks.tradeHistory.insertOne.mockResolvedValue({ insertedId: new ObjectId() });
    // One mock serves two reads: the taker balance pre-check and the sender
    // mail lookup after settlement.
    db.collectionMocks.characters.findOne.mockImplementation((filter: { _id: ObjectId }) => {
      if (filter._id.toString() === targetId.toString()) {
        return Promise.resolve({
          _id: targetId,
          currencyBalances: { personal: { GBP: 50_000, USD: 0 } },
        });
      }
      return Promise.resolve({ _id: senderId, userId: new ObjectId(), sequentialId: 9 });
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

  it("accept replays on a same-key retry: 200 twice, money and mail move once", async () => {
    await setupDb();
    const { isForexEnabled } = await import("@/lib/currency/featureFlag");
    vi.mocked(isForexEnabled).mockResolvedValue(true);

    const targetId = new ObjectId();
    const senderId = new ObjectId();
    const reqId = new ObjectId();
    const key = "accept-key-replay";

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
      filledAmount: 0,
      spreadCharged: 0,
      limitRate: 0.75,
    });

    db.collectionMocks.gameState.findOne.mockResolvedValue({ currentTurn: 12 });
    db.collectionMocks.characters.updateOne.mockResolvedValue({
      modifiedCount: 1,
      matchedCount: 1,
    });
    db.collectionMocks.currencyOrders.updateOne.mockResolvedValue({
      modifiedCount: 1,
      matchedCount: 1,
    });
    db.collectionMocks.tradeHistory.insertOne.mockResolvedValue({ insertedId: new ObjectId() });
    db.collectionMocks.characters.findOne.mockImplementation((filter: { _id: ObjectId }) => {
      if (filter._id.toString() === targetId.toString()) {
        return Promise.resolve({
          _id: targetId,
          currencyBalances: { personal: { GBP: 50_000, USD: 0 } },
        });
      }
      return Promise.resolve({ _id: senderId, userId: new ObjectId(), sequentialId: 9 });
    });
    db.collectionMocks.playerMail.insertOne.mockResolvedValue({ insertedId: new ObjectId() });

    const acceptReq = () =>
      POST_DIRECT_TRADE(
        new Request("http://localhost", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Idempotency-Key": key },
          body: JSON.stringify({ action: "accept" }),
        }),
        { params: Promise.resolve({ requestId: reqId.toString() }) }
      );

    const first = await acceptReq();
    expect(first.status).toBe(200);
    const firstJson = await first.json();
    expect(firstJson).toMatchObject({ success: true, action: "accepted" });
    const charWritesAfterFirst = db.collectionMocks.characters.updateOne.mock.calls.length;
    const orderWritesAfterFirst = db.collectionMocks.currencyOrders.updateOne.mock.calls.length;

    // Same key hits the completed receipt: the stored history row replays the
    // outcome, and the route skips settlement, transition, and mail.
    const storedTrade = db.collectionMocks.tradeHistory.insertOne.mock.calls[0][0];
    db.collectionMocks.tradeHistory.findOne.mockResolvedValue(storedTrade);
    db.collectionMocks.nonAtomicMoneyFlowReceipts.insertOne.mockRejectedValue(
      Object.assign(new Error("E11000 duplicate key"), { code: 11000 })
    );
    db.collectionMocks.nonAtomicMoneyFlowReceipts.findOne.mockResolvedValue({
      _id: key,
      status: "completed",
      fingerprint: `forex-direct:${reqId.toHexString()}:${targetId.toHexString()}`,
    });

    const second = await acceptReq();
    expect(second.status).toBe(200);
    const secondJson = await second.json();
    expect(secondJson).toMatchObject({ success: true, action: "accepted" });
    expect(secondJson.trade).toEqual(firstJson.trade);
    expect(db.collectionMocks.characters.updateOne.mock.calls.length).toBe(charWritesAfterFirst);
    expect(db.collectionMocks.currencyOrders.updateOne.mock.calls.length).toBe(
      orderWritesAfterFirst
    );
    expect(db.collectionMocks.tradeHistory.insertOne).toHaveBeenCalledTimes(1);
    expect(db.collectionMocks.playerMail.insertOne).toHaveBeenCalledTimes(1);
  });

  it("accept returns 400 for an over-long Idempotency-Key without settling", async () => {
    await setupDb();
    const { isForexEnabled } = await import("@/lib/currency/featureFlag");
    vi.mocked(isForexEnabled).mockResolvedValue(true);

    const targetId = new ObjectId();
    const senderId = new ObjectId();
    const reqId = new ObjectId();

    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue(
      authOk({ _id: targetId, name: "Target", countryId: "US", sequentialId: 3 })
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
      filledAmount: 0,
      spreadCharged: 0,
      limitRate: 0.75,
    });

    const res = await POST_DIRECT_TRADE(
      new Request("http://localhost", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": "k".repeat(129) },
        body: JSON.stringify({ action: "accept" }),
      }),
      { params: Promise.resolve({ requestId: reqId.toString() }) }
    );

    expect(res.status).toBe(400);
    expect(db.collectionMocks.characters.updateOne).not.toHaveBeenCalled();
    expect(db.collectionMocks.tradeHistory.insertOne).not.toHaveBeenCalled();
  });

  it("accept fails closed without touching the order when the taker debit races", async () => {
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
      filledAmount: 0,
      spreadCharged: 0,
      limitRate: 0.75,
    });
    db.collectionMocks.gameState.findOne.mockResolvedValue({ currentTurn: 12 });
    // The pre-check sees a funded target, but the taker-settle leg loses its
    // atomic guard at step time (the balance moved first). The receipt
    // settles failed with nothing applied: no sender credit, no order
    // transition, no history row, no mail.
    db.collectionMocks.characters.findOne.mockResolvedValue({
      _id: targetId,
      currencyBalances: { personal: { GBP: 50_000, USD: 0 } },
    });
    db.collectionMocks.characters.updateOne.mockResolvedValue({
      modifiedCount: 0,
      matchedCount: 0,
    });

    const res = await POST_DIRECT_TRADE(
      new Request("http://localhost", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "accept" }),
      }),
      { params: Promise.resolve({ requestId: reqId.toString() }) }
    );
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("Insufficient");
    // The taker-settle leg is the first step: one guarded attempt, then the
    // flow stops before the order transition.
    expect(db.collectionMocks.characters.updateOne).toHaveBeenCalledTimes(1);
    expect(db.collectionMocks.currencyOrders.updateOne).not.toHaveBeenCalled();
    expect(db.collectionMocks.tradeHistory.insertOne).not.toHaveBeenCalled();
    expect(db.collectionMocks.playerMail.insertOne).not.toHaveBeenCalled();
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
  it("compensates the escrow when request creation fails after the debit", async () => {
    await setupDb();
    // Exercise the standalone fallback explicitly: transactions unsupported,
    // so the keyed sequential path must still reconcile to no partial state.
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
    db.collectionMocks.characters.updateOne.mockResolvedValue({
      modifiedCount: 1,
      matchedCount: 1,
    });
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
    // The failed request-row insert reverses the applied escrow prefix with
    // a compensation leg instead of stranding the debit.
    const refundCall = db.collectionMocks.characters.updateOne.mock.calls[1];
    expect(refundCall[0]).toMatchObject({ _id: senderId });
    expect(refundCall[1]).toMatchObject({
      $inc: { "currencyBalances.personal.USD": 500 },
    });
    const receiptUpdate = db.collectionMocks.nonAtomicMoneyFlowReceipts.updateOne.mock.calls.find(
      (call) => (call[1] as { $set?: { status?: string } }).$set?.status === "compensated"
    );
    expect(receiptUpdate).toBeDefined();
    expect(db.collectionMocks.playerMail.insertOne).not.toHaveBeenCalled();
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

  it("replays the same request id on a same-key retry: one escrow debit", async () => {
    await setupDb();
    const { isForexEnabled } = await import("@/lib/currency/featureFlag");
    vi.mocked(isForexEnabled).mockResolvedValue(true);

    const senderId = new ObjectId();
    const targetId = new ObjectId();
    const key = "direct-create-key-replay";
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
    db.collectionMocks.currencyOrders.insertOne.mockResolvedValue({
      insertedId: new ObjectId(),
    });
    db.collectionMocks.playerMail.insertOne.mockResolvedValue({ insertedId: new ObjectId() });

    const createReq = () =>
      POST_DIRECT_TRADE_REQUEST(
        new Request("http://localhost", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Idempotency-Key": key },
          body: JSON.stringify({
            targetCharacterId: targetId.toString(),
            fromCurrency: "USD",
            toCurrency: "GBP",
            amount: 500,
            proposedRate: 0.78,
          }),
        })
      );

    const first = await createReq();
    expect(first.status).toBe(200);
    const firstJson = await first.json();
    // The request id derives from the key: a retry can never open a second order.
    expect(firstJson.requestId).toBe(keyedInsertId(key, "forex-order").toHexString());
    const escrowDebitsAfterFirst = db.collectionMocks.characters.updateOne.mock.calls.filter(
      ([, update]) =>
        (update as { $inc?: Record<string, number> }).$inc?.["currencyBalances.personal.USD"] ===
        -500
    ).length;

    // Same key + same inputs hits the completed receipt and replays the stored
    // request id without escrowing again.
    db.collectionMocks.nonAtomicMoneyFlowReceipts.insertOne.mockRejectedValue(
      Object.assign(new Error("E11000 duplicate key"), { code: 11000 })
    );
    db.collectionMocks.nonAtomicMoneyFlowReceipts.findOne.mockResolvedValue({
      _id: key,
      status: "completed",
      fingerprint: `forex-order:${senderId.toHexString()}:direct:USD:GBP:500:0.78:buy:default:${targetId.toHexString()}`,
    });

    const second = await createReq();
    expect(second.status).toBe(200);
    const secondJson = await second.json();
    expect(secondJson.requestId).toBe(firstJson.requestId);
    const escrowDebitsAfterSecond = db.collectionMocks.characters.updateOne.mock.calls.filter(
      ([, update]) =>
        (update as { $inc?: Record<string, number> }).$inc?.["currencyBalances.personal.USD"] ===
        -500
    ).length;
    expect(escrowDebitsAfterSecond).toBe(escrowDebitsAfterFirst);
    expect(db.collectionMocks.currencyOrders.insertOne).toHaveBeenCalledTimes(1);
  });

  it("returns 400 for an over-long Idempotency-Key without escrowing", async () => {
    await setupDb();
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

    const res = await POST_DIRECT_TRADE_REQUEST(
      new Request("http://localhost", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": "k".repeat(129) },
        body: JSON.stringify({
          targetCharacterId: targetId.toString(),
          fromCurrency: "USD",
          toCurrency: "GBP",
          amount: 500,
          proposedRate: 0.78,
        }),
      })
    );

    expect(res.status).toBe(400);
    expect(db.collectionMocks.characters.updateOne).not.toHaveBeenCalled();
    expect(db.collectionMocks.currencyOrders.insertOne).not.toHaveBeenCalled();
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
