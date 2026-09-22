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
  db.collectionMocks.bondMarketPools.findOne.mockImplementation(
    async (filter: Record<string, unknown>) =>
      "settledKeys" in filter ? null : { _id: "USD", cashLocal: 1e9 }
  );
  db.collectionMocks.bondMarketPools.findOneAndUpdate.mockResolvedValue({ cashLocal: 1e9 });

  db.collection("bondSaleIntents");
  const intents: Array<Record<string, unknown>> = [];
  const matches = (row: Record<string, unknown>, filter: Record<string, unknown>) =>
    Object.entries(filter).every(([key, value]) => {
      const actual = row[key];
      if (actual instanceof ObjectId && value instanceof ObjectId) return actual.equals(value);
      return actual === value;
    });
  db.collectionMocks.bondSaleIntents.insertOne.mockImplementation(
    async (intent: Record<string, unknown>) => {
      intents.push({ ...intent });
      return { insertedId: intent._id };
    }
  );
  db.collectionMocks.bondSaleIntents.findOne.mockImplementation(
    async (filter: Record<string, unknown>) => intents.find((row) => matches(row, filter)) ?? null
  );
  db.collectionMocks.bondSaleIntents.find.mockImplementation((filter: Record<string, unknown>) => {
    const cursor = {
      sort: () => cursor,
      limit: () => cursor,
      toArray: async () => intents.filter((row) => matches(row, filter)),
    };
    return cursor;
  });
  db.collectionMocks.bondSaleIntents.updateOne.mockImplementation(
    async (filter: Record<string, unknown>, update: { $set?: Record<string, unknown> }) => {
      const row = intents.find((candidate) => matches(candidate, filter));
      if (!row) return { matchedCount: 0, modifiedCount: 0 };
      Object.assign(row, update.$set);
      return { matchedCount: 1, modifiedCount: 1 };
    }
  );
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

  it("refunds the pool when the payout fails after the pool was debited", async () => {
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
    const seller = {
      _id: characterId,
      userId,
      name: "Seller",
      countryId: "US",
    };
    db.collectionMocks.characters.findOne.mockImplementation(
      async (filter: Record<string, unknown>) => ("userId" in filter ? seller : null)
    );
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
    // Three units at the 980 bid: debited 2,940 from the pool, then put it back.
    expect(db.collectionMocks.bondMarketPools.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        _id: "USD",
        cashLocal: { $gte: 2940 },
        settledKeys: { $ne: expect.any(String) },
      }),
      expect.objectContaining({ $inc: { cashLocal: -2940, "lifetime.salesOut": 2940 } }),
      expect.anything()
    );
    expect(db.collectionMocks.bondMarketPools.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ _id: "USD", settledKeys: expect.any(String) }),
      expect.objectContaining({
        $inc: { cashLocal: 2940, "lifetime.salesOut": -2940 },
        $pull: { settledKeys: expect.any(String) },
      })
    );
  });

  it("rolls back the holder claim when the character payout disappears in fallback mode", async () => {
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
    const seller = {
      _id: characterId,
      userId,
      name: "Seller",
      countryId: "US",
    };
    db.collectionMocks.characters.findOne.mockImplementation(
      async (filter: Record<string, unknown>) => ("userId" in filter ? seller : null)
    );
    db.collectionMocks.bonds.updateOne
      .mockResolvedValueOnce({ matchedCount: 1, modifiedCount: 1 })
      .mockResolvedValueOnce({ matchedCount: 1, modifiedCount: 1 });
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
    const restoreCall = db.collectionMocks.bonds.updateOne.mock.calls.find(
      (call) => call[1]?.$inc?.publicFloat === -3
    );
    expect(restoreCall).toBeDefined();
    expect(restoreCall?.[0]).toEqual(
      expect.objectContaining({
        _id: bondId,
        holders: {
          $elemMatch: expect.objectContaining({ characterId, saleIntentId: expect.any(ObjectId) }),
        },
      })
    );
  });

  it("keeps a completed fallback sale when zero-unit holder cleanup fails", async () => {
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
      holders: [{ characterId, units: 3 }],
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
    db.collectionMocks.bonds.updateOne
      .mockResolvedValueOnce({ matchedCount: 1, modifiedCount: 1 })
      .mockRejectedValueOnce(new Error("cleanup unavailable"));
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
    expect(db.collectionMocks.bondMarketPools.updateOne).not.toHaveBeenCalled();
    expect(db.collectionMocks.bonds.updateOne).toHaveBeenCalledTimes(2);
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
