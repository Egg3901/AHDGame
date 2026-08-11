import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireBasicAuth: vi.fn() }));
vi.mock("@/lib/api/rateLimit", () => ({
  checkRateLimit: vi.fn().mockReturnValue({ ok: true }),
  rateLimitResponse: vi.fn(),
}));
vi.mock("@/lib/notifications", () => ({
  createNotification: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/financialTxLog/emit", () => ({
  emitTx: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/db/characterLookup", () => ({
  getCharacterByUserId: vi.fn(),
}));
vi.mock("@/lib/currency/featureFlag", () => ({
  isForexEnabled: vi.fn().mockResolvedValue(false),
}));
vi.mock("@/lib/time/gameTime", () => ({
  getGameTime: vi.fn().mockResolvedValue({ currentTurn: 100, effectiveNow: new Date() }),
}));

let db: MockDb;

beforeEach(() => {
  db = createMockDb();
  vi.clearAllMocks();
  db.collection("users");
  db.collection("characters");
});

async function setupBase() {
  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

  const { requireBasicAuth } = await import("@/lib/api/requireAuth");
  vi.mocked(requireBasicAuth).mockResolvedValue({
    ok: true,
    user: { userId: new ObjectId().toString() },
  } as never);

  const { getCharacterByUserId } = await import("@/lib/db/characterLookup");
  vi.mocked(getCharacterByUserId).mockResolvedValue({
    _id: new ObjectId(),
    userId: new ObjectId(),
    name: "Sender",
    countryId: "US",
    cashOnHand: 2_000_000,
  } as never);
}

describe("POST /api/characters/[id]/wire", () => {
  it("returns 429 when the atomic quota claim fails after a stale pre-check", async () => {
    await setupBase();
    const targetId = new ObjectId();
    const senderUserId = new ObjectId();

    const { requireBasicAuth } = await import("@/lib/api/requireAuth");
    vi.mocked(requireBasicAuth).mockResolvedValue({
      ok: true,
      user: { userId: senderUserId.toString() },
    } as never);

    db.collectionMocks.characters.findOne.mockResolvedValue({
      _id: targetId,
      userId: new ObjectId(),
      name: "Recipient",
      countryId: "US",
    });
    db.collectionMocks.users.findOne
      .mockResolvedValueOnce({
        _id: senderUserId,
        wireQuotaUsed: 0,
        wireQuotaWindowStart: new Date(),
      })
      .mockResolvedValueOnce({
        _id: senderUserId,
        wireQuotaUsed: 5_000_000,
        wireQuotaWindowStart: new Date(),
      });
    db.collectionMocks.users.updateOne.mockResolvedValueOnce({ modifiedCount: 0, matchedCount: 1 });

    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://localhost/api/characters/x/wire", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: 1_000_000 }),
      }),
      { params: Promise.resolve({ id: targetId.toString() }) }
    );

    expect(response.status).toBe(429);
    expect(db.collectionMocks.characters.updateOne).not.toHaveBeenCalled();
  });

  it("rolls back the quota claim when the sender debit loses a balance race", async () => {
    await setupBase();
    const targetId = new ObjectId();
    const senderId = new ObjectId();
    const senderUserId = new ObjectId();

    const { requireBasicAuth } = await import("@/lib/api/requireAuth");
    vi.mocked(requireBasicAuth).mockResolvedValue({
      ok: true,
      user: { userId: senderUserId.toString() },
    } as never);

    const { getCharacterByUserId } = await import("@/lib/db/characterLookup");
    vi.mocked(getCharacterByUserId).mockResolvedValue({
      _id: senderId,
      userId: senderUserId,
      name: "Sender",
      countryId: "US",
      cashOnHand: 2_000_000,
    } as never);

    db.collectionMocks.characters.findOne.mockResolvedValue({
      _id: targetId,
      userId: new ObjectId(),
      name: "Recipient",
      countryId: "US",
    });
    db.collectionMocks.users.findOne.mockResolvedValue({
      _id: senderUserId,
      wireQuotaUsed: 0,
      wireQuotaWindowStart: new Date(),
    });
    db.collectionMocks.users.updateOne
      .mockResolvedValueOnce({ modifiedCount: 1, matchedCount: 1 })
      .mockResolvedValueOnce({ modifiedCount: 1, matchedCount: 1 });
    db.collectionMocks.characters.updateOne.mockResolvedValueOnce({
      modifiedCount: 0,
      matchedCount: 1,
    });

    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://localhost/api/characters/x/wire", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: 1_000_000 }),
      }),
      { params: Promise.resolve({ id: targetId.toString() }) }
    );

    expect(response.status).toBe(400);
    expect(db.collectionMocks.users.updateOne).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ _id: senderUserId }),
      expect.objectContaining({
        $inc: expect.objectContaining({ wireQuotaUsed: -1_000_000 }),
      })
    );
  });

  it("blocks a cross-country wire when forex is disabled", async () => {
    await setupBase();
    const targetId = new ObjectId();

    db.collectionMocks.characters.findOne.mockResolvedValue({
      _id: targetId,
      userId: new ObjectId(),
      name: "Recipient",
      countryId: "UK",
    });
    db.collectionMocks.users.findOne.mockResolvedValue({
      _id: new ObjectId(),
      wireQuotaUsed: 0,
      wireQuotaWindowStart: new Date(),
    });

    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://localhost/api/characters/x/wire", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: 1_000_000 }),
      }),
      { params: Promise.resolve({ id: targetId.toString() }) }
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("You cannot wire funds to politicians from other countries");
    expect(db.collectionMocks.characters.updateOne).not.toHaveBeenCalled();
  });

  it("allows a cross-country wire when forex is enabled", async () => {
    await setupBase();
    db.collection("exchangeRates");
    const targetId = new ObjectId();
    const senderId = new ObjectId();
    const senderUserId = new ObjectId();

    const { isForexEnabled } = await import("@/lib/currency/featureFlag");
    vi.mocked(isForexEnabled).mockResolvedValueOnce(true);

    const { requireBasicAuth } = await import("@/lib/api/requireAuth");
    vi.mocked(requireBasicAuth).mockResolvedValue({
      ok: true,
      user: { userId: senderUserId.toString() },
    } as never);

    const { getCharacterByUserId } = await import("@/lib/db/characterLookup");
    vi.mocked(getCharacterByUserId).mockResolvedValue({
      _id: senderId,
      userId: senderUserId,
      name: "Sender",
      countryId: "US",
      currencyBalances: { personal: { USD: 2_000_000 } },
    } as never);

    db.collectionMocks.characters.findOne.mockResolvedValue({
      _id: targetId,
      userId: new ObjectId(),
      name: "Recipient",
      countryId: "UK",
    });
    db.collectionMocks.users.findOne.mockResolvedValue({
      _id: senderUserId,
      wireQuotaUsed: 0,
      wireQuotaWindowStart: new Date(),
    });
    db.collectionMocks.exchangeRates.findOne.mockResolvedValue({
      currencyCode: "USD",
      rate: 1.0,
    });
    db.collectionMocks.users.updateOne.mockResolvedValue({ modifiedCount: 1, matchedCount: 1 });
    db.collectionMocks.characters.updateOne.mockResolvedValue({
      modifiedCount: 1,
      matchedCount: 1,
    });

    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://localhost/api/characters/x/wire", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: 1_000_000 }),
      }),
      { params: Promise.resolve({ id: targetId.toString() }) }
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.currency).toBe("USD");
    // Sender debited and recipient credited in the same currency bucket.
    expect(db.collectionMocks.characters.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ _id: senderId }),
      expect.objectContaining({
        $inc: expect.objectContaining({ "currencyBalances.personal.USD": -1_000_000 }),
      })
    );
    expect(db.collectionMocks.characters.updateOne).toHaveBeenCalledWith(
      { _id: targetId },
      expect.objectContaining({
        $inc: expect.objectContaining({ "currencyBalances.personal.USD": 1_000_000 }),
      })
    );
  });

  it("blocks a new character (within the 24-turn barrier) with 403", async () => {
    await setupBase();
    const targetId = new ObjectId();
    const senderUserId = new ObjectId();

    const { requireBasicAuth } = await import("@/lib/api/requireAuth");
    vi.mocked(requireBasicAuth).mockResolvedValue({
      ok: true,
      user: { userId: senderUserId.toString() },
    } as never);

    // getGameTime mock reports currentTurn 100; createdTurn 90 → 14 turns remain.
    const { getCharacterByUserId } = await import("@/lib/db/characterLookup");
    vi.mocked(getCharacterByUserId).mockResolvedValue({
      _id: new ObjectId(),
      userId: senderUserId,
      name: "Sender",
      countryId: "US",
      cashOnHand: 2_000_000,
      createdTurn: 90,
    } as never);

    db.collectionMocks.characters.findOne.mockResolvedValue({
      _id: targetId,
      userId: new ObjectId(),
      name: "Recipient",
      countryId: "US",
    });

    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://localhost/api/characters/x/wire", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: 1_000_000 }),
      }),
      { params: Promise.resolve({ id: targetId.toString() }) }
    );

    expect(response.status).toBe(403);
    expect(db.collectionMocks.characters.updateOne).not.toHaveBeenCalled();
  });
});
