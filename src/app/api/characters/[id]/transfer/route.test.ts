import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

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
vi.mock("@/lib/api/requireAuth", () => ({ requireBasicAuth: vi.fn() }));
vi.mock("@/lib/api/rateLimit", () => ({
  checkRateLimit: vi.fn().mockReturnValue({ ok: true }),
  rateLimitResponse: vi.fn(),
}));
vi.mock("@/lib/api/requirePlayerTransfers", () => ({
  requirePlayerTransfersEnabled: vi.fn(),
}));
vi.mock("@/lib/db/characterLookup", () => ({
  getCharacterByUserId: vi.fn(),
}));
vi.mock("@/lib/financialTxLog/emit", () => ({
  emitTx: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/time/gameTime", () => ({
  getGameTime: vi.fn().mockResolvedValue({ currentTurn: 100, effectiveNow: new Date() }),
}));
vi.mock("@/lib/currency/featureFlag", () => ({
  isForexEnabled: vi.fn().mockResolvedValue(false),
}));
vi.mock("@/lib/currency/characterFunds", () => ({
  getHomeCurrency: vi.fn().mockReturnValue("USD"),
  loadCharacterFxRate: vi.fn().mockResolvedValue({ ok: true, rate: 1 }),
}));

let db: MockDb;

const senderId = new ObjectId();
const senderUserId = new ObjectId();
const targetId = new ObjectId();

beforeEach(() => {
  db = createMockDb();
  vi.clearAllMocks();
});

async function setup() {
  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as never);

  const { requireBasicAuth } = await import("@/lib/api/requireAuth");
  vi.mocked(requireBasicAuth).mockResolvedValue({
    ok: true,
    user: {
      userId: senderUserId.toString(),
      isAdmin: false,
    },
  } as never);

  const { requirePlayerTransfersEnabled } = await import("@/lib/api/requirePlayerTransfers");
  vi.mocked(requirePlayerTransfersEnabled).mockResolvedValue(null as never);

  const { getCharacterByUserId } = await import("@/lib/db/characterLookup");
  vi.mocked(getCharacterByUserId).mockResolvedValue({
    _id: senderId,
    userId: senderUserId,
    name: "Sender",
    countryId: "US",
    funds: 10_000,
  } as never);

  db.collection("characters");
  db.collectionMocks.characters.findOne.mockResolvedValue({
    _id: targetId,
    userId: new ObjectId(),
    name: "Recipient",
    countryId: "US",
    funds: 500,
  });
  db.collectionMocks.characters.updateOne.mockResolvedValue({
    matchedCount: 1,
    modifiedCount: 1,
  });
}

describe("POST /api/characters/[id]/transfer", () => {
  it("returns 403 when player transfers are paused", async () => {
    await setup();

    const { requirePlayerTransfersEnabled } = await import("@/lib/api/requirePlayerTransfers");
    vi.mocked(requirePlayerTransfersEnabled).mockResolvedValue(
      new Response(JSON.stringify({ error: "paused" }), { status: 403 }) as never
    );

    const { POST } = await import("./route");
    const req = new Request("http://localhost/api/characters/507f1f77bcf86cd799439012/transfer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount: 1000 }),
    });

    const res = await POST(req, { params: Promise.resolve({ id: "507f1f77bcf86cd799439012" }) });
    expect(res.status).toBe(403);
    expect(db.collectionMocks.characters.findOne).not.toHaveBeenCalled();
  });

  it("refunds the sender when the recipient disappears after the debit", async () => {
    await setup();

    db.collectionMocks.characters.updateOne
      .mockResolvedValueOnce({ matchedCount: 1, modifiedCount: 1 })
      .mockResolvedValueOnce({ matchedCount: 0, modifiedCount: 0 })
      .mockResolvedValueOnce({ matchedCount: 1, modifiedCount: 1 });

    const { POST } = await import("./route");
    const req = new Request(`http://localhost/api/characters/${targetId.toString()}/transfer`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount: 1000 }),
    });

    const res = await POST(req, { params: Promise.resolve({ id: targetId.toString() }) });
    expect(res.status).toBe(404);
    expect(db.collectionMocks.characters.updateOne).toHaveBeenCalledTimes(3);

    const refundCall = db.collectionMocks.characters.updateOne.mock.calls[2];
    expect(refundCall[0]).toMatchObject({ _id: senderId });
    expect((refundCall[1] as Record<string, Record<string, number>>)["$inc"]).toMatchObject({
      funds: 1000,
    });
  });

  it("moves the literal local amount when forex is enabled (no FX inflation)", async () => {
    await setup();

    // CNY player, live rate ≈ 8 ¥ per anchor. The request amount is already in
    // the sender's home currency (¥), so the debit must be exactly that amount —
    // NOT amount × rate. Regression for bug #0687 (¥100,000 → ¥800,000).
    const { isForexEnabled } = await import("@/lib/currency/featureFlag");
    vi.mocked(isForexEnabled).mockResolvedValue(true);
    const { getHomeCurrency, loadCharacterFxRate } = await import("@/lib/currency/characterFunds");
    vi.mocked(getHomeCurrency).mockReturnValue("CNY");
    vi.mocked(loadCharacterFxRate).mockResolvedValue({ ok: true, rate: 8 } as never);

    const { getCharacterByUserId } = await import("@/lib/db/characterLookup");
    vi.mocked(getCharacterByUserId).mockResolvedValue({
      _id: senderId,
      userId: senderUserId,
      name: "Sender",
      countryId: "CN",
      currencyBalances: { campaign: 1_000_000 },
    } as never);
    db.collectionMocks.characters.findOne.mockResolvedValue({
      _id: targetId,
      userId: new ObjectId(),
      name: "Recipient",
      countryId: "CN",
      currencyBalances: { campaign: 0 },
    });

    const { POST } = await import("./route");
    const req = new Request(`http://localhost/api/characters/${targetId.toString()}/transfer`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount: 100_000 }),
    });

    const res = await POST(req, { params: Promise.resolve({ id: targetId.toString() }) });
    expect(res.status).toBe(200);

    const debitCall = db.collectionMocks.characters.updateOne.mock.calls[0];
    expect((debitCall[1] as Record<string, Record<string, number>>)["$inc"]).toMatchObject({
      "currencyBalances.campaign": -100_000,
    });
    const creditCall = db.collectionMocks.characters.updateOne.mock.calls[1];
    expect((creditCall[1] as Record<string, Record<string, number>>)["$inc"]).toMatchObject({
      "currencyBalances.campaign": 100_000,
    });
  });

  it("blocks a new character (within the 24-turn barrier) with 403", async () => {
    await setup();

    // getGameTime mock reports currentTurn 100; createdTurn 90 → 14 turns remain.
    const { getCharacterByUserId } = await import("@/lib/db/characterLookup");
    vi.mocked(getCharacterByUserId).mockResolvedValue({
      _id: senderId,
      userId: senderUserId,
      name: "Sender",
      countryId: "US",
      funds: 10_000,
      // Forex-on senders hold campaign funds here, not the legacy `funds` field.
      currencyBalances: { campaign: 10_000 },
      createdTurn: 90,
    } as never);

    const { POST } = await import("./route");
    const req = new Request(`http://localhost/api/characters/${targetId.toString()}/transfer`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount: 1000 }),
    });

    const res = await POST(req, { params: Promise.resolve({ id: targetId.toString() }) });
    expect(res.status).toBe(403);
    expect(db.collectionMocks.characters.updateOne).not.toHaveBeenCalled();
  });
});
