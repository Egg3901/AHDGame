import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
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
vi.mock("@/lib/currency/featureFlag", () => ({
  isForexEnabled: vi.fn().mockResolvedValue(false),
}));
vi.mock("@/lib/financialTxLog/emit", () => ({
  emitTx: vi.fn().mockResolvedValue(undefined),
}));

let db: MockDb;

beforeEach(() => {
  db = createMockDb();
  vi.clearAllMocks();
  db.collection("bonds");
  db.collection("characters");
  db.collection("users");
  // A flush market pool: every sale in these tests is small.
  db.collection("bondMarketPools");
  db.collectionMocks.bondMarketPools.findOne.mockResolvedValue({ _id: "USD", cashLocal: 1e9 });
  db.collectionMocks.bondMarketPools.findOneAndUpdate.mockResolvedValue({ cashLocal: 1e9 });
});

describe("POST /api/bonds/[bondId]/sell", () => {
  it("refuses a sale the market pool cannot pay for and says how much it can take", async () => {
    const bondId = new ObjectId();
    const characterId = new ObjectId();
    const userId = new ObjectId();

    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
    const { requireBasicAuth } = await import("@/lib/api/requireAuth");
    vi.mocked(requireBasicAuth).mockResolvedValue({
      ok: true,
      user: { userId: userId.toString() },
    } as never);

    db.collectionMocks.bonds.findOne.mockResolvedValueOnce({
      _id: bondId,
      defaulted: false,
      marketPrice: 1,
      currencyCode: "USD",
      holders: [{ characterId, units: 50 }],
    });
    // Bid is 980 per unit (mid 1,000 less the 2% corporate half spread);
    // 2,500 of cash buys two units and the player asks for ten.
    db.collectionMocks.bondMarketPools.findOne.mockResolvedValue({ _id: "USD", cashLocal: 2_500 });

    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://localhost/api/bonds/x/sell", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ units: 10 }),
      }),
      { params: Promise.resolve({ bondId: bondId.toString() }) }
    );

    expect(response.status).toBe(409);
    const body = (await response.json()) as { error: string; marketDepthUnits: number };
    expect(body.marketDepthUnits).toBe(2);
    expect(body.error).toContain("2 units");
    // Nothing was claimed or paid.
    expect(db.collectionMocks.bonds.updateOne).not.toHaveBeenCalled();
    expect(db.collectionMocks.bondMarketPools.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it("compensates the pool debit when the payout fails after the pool was debited", async () => {
    const bondId = new ObjectId();
    const characterId = new ObjectId();
    const userId = new ObjectId();

    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
    const { requireBasicAuth } = await import("@/lib/api/requireAuth");
    vi.mocked(requireBasicAuth).mockResolvedValue({
      ok: true,
      user: { userId: userId.toString() },
    } as never);

    db.collectionMocks.bonds.findOne.mockResolvedValueOnce({
      _id: bondId,
      defaulted: false,
      marketPrice: 1,
      currencyCode: "USD",
      holders: [{ characterId, units: 5 }],
    });
    db.collectionMocks.users.findOne.mockResolvedValue({
      _id: userId,
      activeCharacterId: characterId,
    });
    db.collectionMocks.characters.findOne.mockResolvedValue({
      _id: characterId,
      userId,
      name: "Seller",
      countryId: "US",
    });
    db.collectionMocks.bonds.updateOne.mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });
    db.collectionMocks.characters.updateOne.mockResolvedValue({
      matchedCount: 0,
      modifiedCount: 0,
    });

    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://localhost/api/bonds/x/sell", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ units: 3 }),
      }),
      { params: Promise.resolve({ bondId: bondId.toString() }) }
    );

    expect(response.status).toBe(404);
    // Three units at the 980 bid: keyed debit of 2,940 from the pool, then
    // the keyed compensation puts it back (no findOneAndUpdate anywhere).
    expect(db.collectionMocks.bondMarketPools.findOneAndUpdate).not.toHaveBeenCalled();
    expect(db.collectionMocks.bondMarketPools.updateOne).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ _id: "USD", cashLocal: { $gte: 2940 } }),
      expect.objectContaining({ $inc: { cashLocal: -2940, "lifetime.salesOut": 2940 } }),
      undefined
    );
    expect(db.collectionMocks.bondMarketPools.updateOne).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ _id: "USD" }),
      expect.objectContaining({ $inc: { cashLocal: 2940, "lifetime.salesOut": -2940 } }),
      undefined
    );
  });

  it("restores the holder claim with a compensation key when the payout disappears", async () => {
    const bondId = new ObjectId();
    const characterId = new ObjectId();
    const userId = new ObjectId();

    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

    const { requireBasicAuth } = await import("@/lib/api/requireAuth");
    vi.mocked(requireBasicAuth).mockResolvedValue({
      ok: true,
      user: { userId: userId.toString() },
    } as never);

    db.collectionMocks.bonds.findOne.mockResolvedValue({
      _id: bondId,
      defaulted: false,
      marketPrice: 1,
      currencyCode: "USD",
      holders: [{ characterId, units: 5 }],
    });
    db.collectionMocks.users.findOne.mockResolvedValue({
      _id: userId,
      activeCharacterId: characterId,
    });
    db.collectionMocks.characters.findOne.mockResolvedValue({
      _id: characterId,
      userId,
      name: "Seller",
      countryId: "US",
    });
    db.collectionMocks.bonds.updateOne.mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });
    db.collectionMocks.characters.updateOne.mockResolvedValue({
      matchedCount: 0,
      modifiedCount: 0,
    });

    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://localhost/api/bonds/x/sell", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ units: 3 }),
      }),
      { params: Promise.resolve({ bondId: bondId.toString() }) }
    );

    expect(response.status).toBe(404);
    // Claim lands keyed first; the compensation (not the legacy rollback)
    // restores the units under a `:compensate:` key.
    expect(db.collectionMocks.bonds.updateOne).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ _id: bondId }),
      expect.objectContaining({
        $inc: expect.objectContaining({ "holders.$.units": -3, publicFloat: 3 }),
      }),
      undefined
    );
    expect(db.collectionMocks.bonds.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ _id: bondId, "holders.characterId": characterId }),
      expect.objectContaining({
        $inc: expect.objectContaining({
          "holders.$.units": 3,
          publicFloat: -3,
        }),
        $push: expect.objectContaining({
          appliedMoneyFlowKeys: expect.objectContaining({
            $each: [expect.stringContaining(":compensate:holder-claim")],
          }),
        }),
      }),
      undefined
    );
  });

  it("rejects an invalid Idempotency-Key header without touching money", async () => {
    const bondId = new ObjectId();
    const userId = new ObjectId();

    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
    const { requireBasicAuth } = await import("@/lib/api/requireAuth");
    vi.mocked(requireBasicAuth).mockResolvedValue({
      ok: true,
      user: { userId: userId.toString() },
    } as never);

    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://localhost/api/bonds/x/sell", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": "" },
        body: JSON.stringify({ units: 3 }),
      }),
      { params: Promise.resolve({ bondId: bondId.toString() }) }
    );

    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe("Invalid Idempotency-Key header");
    expect(db.collectionMocks.bonds.updateOne).not.toHaveBeenCalled();
  });

  it("replays the same Idempotency-Key without moving money again", async () => {
    const bondId = new ObjectId();
    const characterId = new ObjectId();
    const userId = new ObjectId();

    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
    const { requireBasicAuth } = await import("@/lib/api/requireAuth");
    vi.mocked(requireBasicAuth).mockResolvedValue({
      ok: true,
      user: { userId: userId.toString() },
    } as never);

    db.collection("gameState");
    db.collectionMocks.gameState.findOne.mockResolvedValue({ _id: "current", currentTurn: 506 });

    const bondDoc = {
      _id: bondId,
      defaulted: false,
      marketPrice: 1,
      currencyCode: "USD",
      holders: [{ characterId, units: 5 }],
      publicFloat: 10,
    };
    db.collectionMocks.bonds.findOne.mockResolvedValue(bondDoc);
    db.collectionMocks.users.findOne.mockResolvedValue({
      _id: userId,
      activeCharacterId: characterId,
    });
    db.collectionMocks.characters.findOne.mockResolvedValue({
      _id: characterId,
      userId,
      name: "Seller",
      countryId: "US",
    });
    db.collectionMocks.bonds.updateOne.mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });
    db.collectionMocks.characters.updateOne.mockResolvedValue({
      matchedCount: 1,
      modifiedCount: 1,
    });

    const receipts = db.collection("nonAtomicMoneyFlowReceipts");
    const fingerprint = `bond-sell:${bondId.toHexString()}:character:${characterId.toHexString()}:3:2940`;

    const { POST } = await import("./route");
    const first = await POST(
      new Request("http://localhost/api/bonds/x/sell", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": "sell-replay-key" },
        body: JSON.stringify({ units: 3 }),
      }),
      { params: Promise.resolve({ bondId: bondId.toString() }) }
    );
    expect(first.status).toBe(200);
    const claimWrites = (): number =>
      db.collectionMocks.bonds.updateOne.mock.calls.filter(
        (call) => (call[1] as { $inc?: Record<string, number> }).$inc?.["holders.$.units"] === -3
      ).length;
    expect(claimWrites()).toBe(1);

    // The stored receipt now settles the retry as a duplicate: the second
    // request replays the outcome without another holder claim.
    const duplicateKeyError = new Error("E11000 duplicate key") as Error & { code: number };
    duplicateKeyError.code = 11000;
    receipts.insertOne.mockRejectedValueOnce(duplicateKeyError);
    receipts.findOne.mockResolvedValue({
      _id: "sell-replay-key",
      status: "completed",
      fingerprint,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const second = await POST(
      new Request("http://localhost/api/bonds/x/sell", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": "sell-replay-key" },
        body: JSON.stringify({ units: 3 }),
      }),
      { params: Promise.resolve({ bondId: bondId.toString() }) }
    );
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual(await first.json());
    // The replay runs no second holder claim (the post-commit zero-unit
    // cleanup may still rewrite the holders array, which moves no units).
    expect(claimWrites()).toBe(1);
  });

  it("keeps a completed sale when zero-unit holder cleanup fails", async () => {
    const bondId = new ObjectId();
    const characterId = new ObjectId();
    const userId = new ObjectId();

    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
    const { requireBasicAuth } = await import("@/lib/api/requireAuth");
    vi.mocked(requireBasicAuth).mockResolvedValue({
      ok: true,
      user: { userId: userId.toString() },
    } as never);

    db.collection("gameState");
    db.collectionMocks.gameState.findOne.mockResolvedValue({ _id: "current", currentTurn: 506 });

    db.collectionMocks.bonds.findOne.mockResolvedValue({
      _id: bondId,
      defaulted: false,
      marketPrice: 1,
      currencyCode: "USD",
      holders: [{ characterId, units: 3 }],
      publicFloat: 10,
    });
    db.collectionMocks.users.findOne.mockResolvedValue({
      _id: userId,
      activeCharacterId: characterId,
    });
    db.collectionMocks.characters.findOne.mockResolvedValue({
      _id: characterId,
      userId,
      name: "Seller",
      countryId: "US",
    });
    // Only the post-commit zero-unit holder cleanup uses a pipeline update;
    // fail exactly that write. The money already moved, so the sale stands.
    db.collectionMocks.bonds.updateOne.mockImplementation(
      async (filter: unknown, update: unknown) => {
        if (Array.isArray(update)) throw new Error("cleanup unavailable");
        return { matchedCount: 1, modifiedCount: 1 };
      }
    );
    db.collectionMocks.characters.updateOne.mockResolvedValue({
      matchedCount: 1,
      modifiedCount: 1,
    });

    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://localhost/api/bonds/x/sell", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ units: 3 }),
      }),
      { params: Promise.resolve({ bondId: bondId.toString() }) }
    );

    expect(response.status).toBe(200);
    expect(db.collectionMocks.characters.updateOne).toHaveBeenCalledOnce();
    // Debit landed once and was never compensated.
    expect(db.collectionMocks.bondMarketPools.updateOne).toHaveBeenCalledOnce();
  });

  it("returns 409 when an Idempotency-Key is reused for a different sale", async () => {
    const bondId = new ObjectId();
    const characterId = new ObjectId();
    const userId = new ObjectId();

    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
    const { requireBasicAuth } = await import("@/lib/api/requireAuth");
    vi.mocked(requireBasicAuth).mockResolvedValue({
      ok: true,
      user: { userId: userId.toString() },
    } as never);

    db.collectionMocks.bonds.findOne.mockResolvedValue({
      _id: bondId,
      defaulted: false,
      marketPrice: 1,
      currencyCode: "USD",
      holders: [{ characterId, units: 5 }],
      publicFloat: 10,
    });
    db.collectionMocks.users.findOne.mockResolvedValue({
      _id: userId,
      activeCharacterId: characterId,
    });
    db.collectionMocks.characters.findOne.mockResolvedValue({
      _id: characterId,
      userId,
      name: "Seller",
      countryId: "US",
    });

    const receipts = db.collection("nonAtomicMoneyFlowReceipts");
    const duplicateKeyError = new Error("E11000 duplicate key") as Error & { code: number };
    duplicateKeyError.code = 11000;
    receipts.insertOne.mockRejectedValue(duplicateKeyError);
    receipts.findOne.mockResolvedValue({
      _id: "conflict-key",
      status: "completed",
      fingerprint: "bond-sell:some-other-sale",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://localhost/api/bonds/x/sell", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": "conflict-key" },
        body: JSON.stringify({ units: 3 }),
      }),
      { params: Promise.resolve({ bondId: bondId.toString() }) }
    );

    expect(response.status).toBe(409);
  });

  it("lets a keyed retry of a started sale past the upfront depth check", async () => {
    const bondId = new ObjectId();
    const characterId = new ObjectId();
    const userId = new ObjectId();

    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
    const { requireBasicAuth } = await import("@/lib/api/requireAuth");
    vi.mocked(requireBasicAuth).mockResolvedValue({
      ok: true,
      user: { userId: userId.toString() },
    } as never);

    db.collection("gameState");
    db.collectionMocks.gameState.findOne.mockResolvedValue({ _id: "current", currentTurn: 506 });

    db.collectionMocks.bonds.findOne.mockResolvedValue({
      _id: bondId,
      defaulted: false,
      marketPrice: 1,
      currencyCode: "USD",
      holders: [{ characterId, units: 10 }],
      publicFloat: 10,
    });
    db.collectionMocks.users.findOne.mockResolvedValue({
      _id: userId,
      activeCharacterId: characterId,
    });
    db.collectionMocks.characters.findOne.mockResolvedValue({
      _id: characterId,
      userId,
      name: "Seller",
      countryId: "US",
    });
    // 2,500 of cash cannot cover ten units at the 980 bid, but the retry
    // carries the key of the sale whose own debit accounts for the
    // shortfall, so the route reconciles instead of refusing.
    db.collectionMocks.bondMarketPools.findOne.mockResolvedValue({ _id: "USD", cashLocal: 2_500 });
    const receipts = db.collection("nonAtomicMoneyFlowReceipts");
    receipts.findOne.mockResolvedValue({
      _id: "retry-key",
      status: "in_progress",
      fingerprint: `bond-sell:${bondId.toHexString()}:character:${characterId.toHexString()}:10:9800`,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    db.collectionMocks.bonds.updateOne.mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });
    db.collectionMocks.characters.updateOne.mockResolvedValue({
      matchedCount: 1,
      modifiedCount: 1,
    });

    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://localhost/api/bonds/x/sell", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": "retry-key" },
        body: JSON.stringify({ units: 10 }),
      }),
      { params: Promise.resolve({ bondId: bondId.toString() }) }
    );

    expect(response.status).toBe(200);
    expect(db.collectionMocks.bonds.updateOne).toHaveBeenCalled();
  });

  it("emits a bond_sell ledger row after a successful character sale", async () => {
    const bondId = new ObjectId();
    const characterId = new ObjectId();
    const userId = new ObjectId();

    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

    const { requireBasicAuth } = await import("@/lib/api/requireAuth");
    vi.mocked(requireBasicAuth).mockResolvedValue({
      ok: true,
      user: { userId: userId.toString() },
    } as never);

    db.collection("gameState");
    db.collectionMocks.gameState.findOne.mockResolvedValue({ _id: "current", currentTurn: 506 });

    db.collectionMocks.bonds.findOne.mockResolvedValueOnce({
      _id: bondId,
      defaulted: false,
      marketPrice: 1.2,
      currencyCode: "USD",
      issuerName: "Japan",
      holders: [{ characterId, units: 5 }],
      publicFloat: 10,
    });
    db.collectionMocks.users.findOne.mockResolvedValue({
      _id: userId,
      activeCharacterId: characterId,
    });
    db.collectionMocks.characters.findOne.mockResolvedValue({
      _id: characterId,
      userId,
      name: "Seller",
      countryId: "US",
    });
    db.collectionMocks.bonds.updateOne.mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });
    db.collectionMocks.characters.updateOne.mockResolvedValue({
      matchedCount: 1,
      modifiedCount: 1,
    });

    const { emitTx } = await import("@/lib/financialTxLog/emit");

    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://localhost/api/bonds/x/sell", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ units: 3 }),
      }),
      { params: Promise.resolve({ bondId: bondId.toString() }) }
    );

    expect(response.status).toBe(200);
    expect(emitTx).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        type: "bond_sell",
        turn: 506,
        subjectType: "character",
        subjectId: characterId,
        subjectName: "Seller",
        amount: 3528,
        currencyCode: "USD",
        counterpartyType: "system",
        counterpartyName: "Japan",
        meta: expect.objectContaining({
          bondId: bondId.toString(),
          units: 3,
          pricePerUnit: 1.176,
        }),
      })
    );
  });
});
