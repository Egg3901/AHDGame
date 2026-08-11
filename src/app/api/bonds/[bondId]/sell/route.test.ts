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
});

describe("POST /api/bonds/[bondId]/sell", () => {
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
    db.collectionMocks.characters.findOne.mockResolvedValue({
      _id: characterId,
      userId,
      name: "Seller",
      countryId: "US",
    });
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
    expect(db.collectionMocks.bonds.updateOne).toHaveBeenNthCalledWith(
      2,
      { _id: bondId, "holders.characterId": characterId },
      expect.objectContaining({
        $inc: expect.objectContaining({
          "holders.$.units": 3,
          publicFloat: -3,
        }),
      })
    );
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
        amount: 3600,
        currencyCode: "USD",
        counterpartyType: "system",
        counterpartyName: "Japan",
        meta: expect.objectContaining({
          bondId: bondId.toString(),
          units: 3,
          pricePerUnit: 1.2,
        }),
      })
    );
  });
});
