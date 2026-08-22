import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/rateLimit", () => ({ checkRateLimit: vi.fn().mockReturnValue({ ok: true }) }));
vi.mock("@/lib/api/requireAuth", () => ({ requireBasicAuth: vi.fn() }));
vi.mock("@/lib/api/requireCorporationActions", () => ({
  requireCorporationActionsEnabled: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/api/corporations/resolveQuery", () => ({
  resolveCorporation: vi.fn(),
  requireCeo: vi.fn().mockReturnValue(null),
}));
vi.mock("@/lib/currency/featureFlag", () => ({ isForexEnabled: vi.fn().mockResolvedValue(false) }));
vi.mock("@/lib/currency/corporationCapital", () => ({
  anchorToCorpLiquidCapital: vi.fn((amount: number) => amount),
  corpLiquidCapitalToAnchor: vi.fn((amount: number) => amount),
  getCorpFxRate: vi.fn().mockResolvedValue(1),
}));
vi.mock("@/lib/corporations/shareTradeHistory", () => ({ recordShareTrade: vi.fn() }));
vi.mock("@/lib/corporations/shareInvariant", () => ({
  computeAccountedShares: vi.fn((corp: { totalShares?: number }) => corp.totalShares ?? 0),
}));
vi.mock("@/lib/turn/currentTurn", () => ({ getCurrentTurn: vi.fn().mockResolvedValue(42) }));
vi.mock("@/lib/financialTxLog/emit", () => ({ emitTx: vi.fn() }));
vi.mock("@/lib/financialTxLog/atomicCashGuard", () => ({
  atomicallyDebitCharacterCash: vi.fn().mockResolvedValue({ ok: true, newBalance: 850 }),
  refundCharacterCash: vi.fn().mockResolvedValue(undefined),
  atomicallyDebitImperialCash: vi.fn().mockResolvedValue({ ok: true, newBalance: 850 }),
  refundImperialCash: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}));

let db: MockDb;

beforeEach(async () => {
  db = createMockDb();
  vi.clearAllMocks();
  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as any);
});

describe("POST /api/corporations/[id]/shares/self-issue", () => {
  it("rejects self-issuance while a shareholder vote is open", async () => {
    const userId = new ObjectId();
    const corporationId = new ObjectId();

    const { requireBasicAuth } = await import("@/lib/api/requireAuth");
    vi.mocked(requireBasicAuth).mockResolvedValue({
      ok: true,
      user: { userId: userId.toString() },
    } as any);

    const { resolveCorporation } = await import("@/lib/api/corporations/resolveQuery");
    vi.mocked(resolveCorporation).mockResolvedValue({
      ok: true,
      corporation: {
        _id: corporationId,
        userId,
        sharePrice: 10,
        totalShares: 1000,
        name: "Test Corp",
        liquidCurrencyCode: "USD",
      },
    } as any);

    db.collection("corporationVotes").findOne.mockResolvedValue({
      _id: new ObjectId(),
      corporationId,
      status: "open",
    });

    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://localhost/api/corporations/abc/shares/self-issue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shares: 10 }),
      }),
      { params: Promise.resolve({ id: "abc" }) }
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Cannot issue shares while a shareholder vote is open",
    });
    expect(db.collectionMocks["corporations"]).toBeUndefined();
  });

  it("restores the issuance cooldown if the corporation write fails after cash debit", async () => {
    const userId = new ObjectId();
    const characterId = new ObjectId();
    const corporationId = new ObjectId();
    const lastShareIssuance = new Date("2026-04-20T12:00:00.000Z");

    const { requireBasicAuth } = await import("@/lib/api/requireAuth");
    vi.mocked(requireBasicAuth).mockResolvedValue({
      ok: true,
      user: { userId: userId.toString() },
    } as any);

    const { resolveCorporation } = await import("@/lib/api/corporations/resolveQuery");
    vi.mocked(resolveCorporation).mockResolvedValue({
      ok: true,
      corporation: {
        _id: corporationId,
        userId,
        ceoId: characterId,
        sharePrice: 10,
        totalShares: 1000,
        lastShareIssuance,
        shareholders: [],
        publicFloat: 0,
        name: "Test Corp",
        liquidCurrencyCode: "USD",
      },
    } as any);

    db.collection("users");
    db.collectionMocks["users"].findOne.mockResolvedValue({
      _id: userId,
      activeCharacterId: characterId,
      activeCharacterType: "character",
    });

    db.collection("characters");
    db.collectionMocks["characters"].findOne.mockResolvedValue({
      _id: characterId,
      userId,
      countryId: "US",
      name: "CEO",
      cashOnHand: 1000,
    });

    db.collection("corporations");
    db.collectionMocks["corporations"].findOneAndUpdate.mockResolvedValue({
      _id: corporationId,
      lastShareIssuance: new Date(),
    });
    db.collectionMocks["corporations"].updateOne
      .mockRejectedValueOnce(new Error("corp write failed"))
      .mockResolvedValueOnce({ matchedCount: 1, modifiedCount: 1 });

    const { refundCharacterCash } = await import("@/lib/financialTxLog/atomicCashGuard");

    const { POST } = await import("./route");
    const req = new Request("http://localhost/api/corporations/abc/shares/self-issue", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ shares: 10 }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: "abc" }) });

    expect(res.status).toBe(500);
    expect(refundCharacterCash).toHaveBeenCalledWith(
      expect.anything(),
      characterId,
      "USD",
      expect.any(Number),
      false
    );
    expect(db.collectionMocks["corporations"].updateOne).toHaveBeenNthCalledWith(
      2,
      { _id: corporationId },
      {
        $set: {
          lastShareIssuance,
          updatedAt: expect.any(Date),
        },
      }
    );
  });

  it("still succeeds if ledger emission fails after a successful issuance", async () => {
    const userId = new ObjectId();
    const characterId = new ObjectId();
    const corporationId = new ObjectId();

    const { requireBasicAuth } = await import("@/lib/api/requireAuth");
    vi.mocked(requireBasicAuth).mockResolvedValue({
      ok: true,
      user: { userId: userId.toString() },
    } as any);

    const { resolveCorporation } = await import("@/lib/api/corporations/resolveQuery");
    vi.mocked(resolveCorporation).mockResolvedValue({
      ok: true,
      corporation: {
        _id: corporationId,
        userId,
        ceoId: characterId,
        sharePrice: 10,
        totalShares: 1000,
        shareholders: [{ characterId, shares: 100 }],
        publicFloat: 0,
        name: "Test Corp",
        liquidCurrencyCode: "USD",
      },
    } as any);

    db.collection("users");
    db.collectionMocks["users"].findOne.mockResolvedValue({
      _id: userId,
      activeCharacterId: characterId,
      activeCharacterType: "character",
    });

    db.collection("characters");
    db.collectionMocks["characters"].findOne.mockResolvedValue({
      _id: characterId,
      userId,
      countryId: "US",
      name: "CEO",
      cashOnHand: 1000,
    });

    db.collection("corporations");
    db.collectionMocks["corporations"].findOneAndUpdate.mockResolvedValue({
      _id: corporationId,
    });
    db.collectionMocks["corporations"].updateOne.mockResolvedValue({
      matchedCount: 1,
      modifiedCount: 1,
    });
    db.collectionMocks["corporations"].findOne.mockResolvedValue({
      _id: corporationId,
      totalShares: 1010,
      shareholders: [{ characterId, shares: 110 }],
      publicFloat: 0,
      name: "Test Corp",
      liquidCurrencyCode: "USD",
    });

    db.collection("shareListings");
    db.collectionMocks["shareListings"].find.mockReturnValue({
      toArray: async () => [],
    } as any);
    db.collection("shareOrders");
    db.collectionMocks["shareOrders"].find.mockReturnValue({
      toArray: async () => [],
    } as any);

    const { emitTx } = await import("@/lib/financialTxLog/emit");
    vi.mocked(emitTx).mockRejectedValueOnce(new Error("ledger offline"));
    const Sentry = await import("@sentry/nextjs");

    const { POST } = await import("./route");
    const req = new Request("http://localhost/api/corporations/abc/shares/self-issue", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ shares: 10 }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: "abc" }) });

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(res.status).toBe(200);
    expect(vi.mocked(Sentry.captureException)).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        tags: { module: "corp/self-issue/ledger" },
      })
    );
  });
});
