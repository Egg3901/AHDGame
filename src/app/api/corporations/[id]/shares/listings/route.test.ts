import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/rateLimit", () => ({ checkRateLimit: vi.fn().mockReturnValue({ ok: true }) }));
vi.mock("@/lib/api/requireAuth", () => ({ requireBasicAuth: vi.fn() }));
vi.mock("@/lib/api/corporations/resolveQuery", () => ({ resolveCorporation: vi.fn() }));
vi.mock("@/lib/api/requireCorporationActions", () => ({
  requireCorporationActionsEnabled: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/lib/db/characterLookup", () => ({
  getCharacterByUserId: vi.fn(),
  bulkFetchCharacterNames: vi.fn().mockResolvedValue(new Map()),
}));
vi.mock("@/lib/corporations/shareholderOps", () => ({
  debitShares: vi.fn().mockResolvedValue(0),
  debitSharesFromCorp: vi.fn().mockResolvedValue(0),
  creditShares: vi.fn().mockResolvedValue(undefined),
  creditSharesToCorp: vi.fn().mockResolvedValue(undefined),
}));

let db: MockDb;

beforeEach(async () => {
  db = createMockDb();
  vi.clearAllMocks();
  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as any);
});

describe("POST /api/corporations/[id]/shares/listings", () => {
  it("ignores already-debited sell orders when checking available shares", async () => {
    const userId = new ObjectId();
    const charId = new ObjectId();
    const corpId = new ObjectId();

    const { requireBasicAuth } = await import("@/lib/api/requireAuth");
    vi.mocked(requireBasicAuth).mockResolvedValue({
      ok: true,
      user: { userId: userId.toString() },
    } as any);

    const { getCharacterByUserId } = await import("@/lib/db/characterLookup");
    vi.mocked(getCharacterByUserId).mockResolvedValue({
      _id: charId,
      userId,
      name: "Seller",
    } as any);

    const { resolveCorporation } = await import("@/lib/api/corporations/resolveQuery");
    vi.mocked(resolveCorporation).mockResolvedValue({
      ok: true,
      corporation: {
        _id: corpId,
        sharePrice: 10,
        totalShares: 1000,
        shareholders: [{ characterId: charId, shares: 100 }],
        ceoId: new ObjectId(),
      },
    } as any);

    db.collection("shareOrders");
    db.collectionMocks["shareOrders"].find.mockReturnValueOnce({
      toArray: async () => [
        {
          _id: new ObjectId(),
          corporationId: corpId,
          characterId: charId,
          type: "sell",
          status: "open",
          sharesRemaining: 100,
          sharesDebitedAtCreation: true,
        },
      ],
    });

    db.collection("shareListings");
    db.collectionMocks["shareListings"].find.mockReturnValueOnce({ toArray: async () => [] });

    const { debitShares } = await import("@/lib/corporations/shareholderOps");
    vi.mocked(debitShares).mockResolvedValueOnce(-1);

    const { POST } = await import("./route");
    const req = new Request("http://localhost/api/corporations/abc/shares/listings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ shares: 100, sellAsCorporation: false }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: "abc" }) });
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json.error).toContain("already sold or reserved");
    expect(debitShares).toHaveBeenCalledWith(
      expect.anything(),
      corpId,
      charId,
      100,
      expect.anything(),
      { requireSufficient: true }
    );
  });

  it("vacates the CEO immediately when they list every unreserved share", async () => {
    const userId = new ObjectId();
    const charId = new ObjectId();
    const corpId = new ObjectId();

    const { requireBasicAuth } = await import("@/lib/api/requireAuth");
    vi.mocked(requireBasicAuth).mockResolvedValue({
      ok: true,
      user: { userId: userId.toString() },
    } as any);

    const { getCharacterByUserId } = await import("@/lib/db/characterLookup");
    vi.mocked(getCharacterByUserId).mockResolvedValue({
      _id: charId,
      userId,
      name: "CEO Seller",
    } as any);

    db.collection("gameState");
    db.collectionMocks["gameState"].findOne.mockResolvedValue({ _id: "current", currentTurn: 42 });

    const { resolveCorporation } = await import("@/lib/api/corporations/resolveQuery");
    vi.mocked(resolveCorporation).mockResolvedValue({
      ok: true,
      corporation: {
        _id: corpId,
        sharePrice: 10,
        totalShares: 1000,
        shareholders: [{ characterId: charId, shares: 100 }],
        ceoId: charId,
        userId,
      },
    } as any);

    db.collection("shareOrders");
    db.collectionMocks["shareOrders"].find.mockReturnValueOnce({ toArray: async () => [] });

    db.collection("shareListings");
    db.collectionMocks["shareListings"].find.mockReturnValueOnce({ toArray: async () => [] });
    db.collectionMocks["shareListings"].insertOne.mockResolvedValue({
      acknowledged: true,
      insertedId: new ObjectId(),
    });

    const { debitShares } = await import("@/lib/corporations/shareholderOps");
    vi.mocked(debitShares).mockResolvedValueOnce(0);

    const { POST } = await import("./route");
    const req = new Request("http://localhost/api/corporations/abc/shares/listings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ shares: 100, sellAsCorporation: false, confirmCeoVacate: true }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: "abc" }) });

    expect(res.status).toBe(200);
    expect(debitShares).toHaveBeenCalledWith(
      expect.anything(),
      corpId,
      charId,
      100,
      {
        $set: expect.objectContaining({
          ceoVacant: true,
          ceoVacantSinceTurn: 42,
        }),
        $unset: { ceoId: "", userId: "", pendingCeoCharacterId: "" },
      },
      { requireSufficient: true }
    );
    expect(db.collectionMocks["corporationCeoVotes"].deleteMany).toHaveBeenCalledWith({
      corporationId: corpId,
    });
  });

  it("returns 409 requiresCeoVacateConfirm without confirmCeoVacate, and makes no mutation", async () => {
    const userId = new ObjectId();
    const charId = new ObjectId();
    const corpId = new ObjectId();

    const { requireBasicAuth } = await import("@/lib/api/requireAuth");
    vi.mocked(requireBasicAuth).mockResolvedValue({
      ok: true,
      user: { userId: userId.toString() },
    } as any);

    const { getCharacterByUserId } = await import("@/lib/db/characterLookup");
    vi.mocked(getCharacterByUserId).mockResolvedValue({
      _id: charId,
      userId,
      name: "CEO Seller",
    } as any);

    const { resolveCorporation } = await import("@/lib/api/corporations/resolveQuery");
    vi.mocked(resolveCorporation).mockResolvedValue({
      ok: true,
      corporation: {
        _id: corpId,
        name: "Acme",
        sharePrice: 10,
        totalShares: 1000,
        shareholders: [{ characterId: charId, shares: 100 }],
        ceoId: charId,
        userId,
      },
    } as any);

    db.collection("shareOrders");
    db.collectionMocks["shareOrders"].find.mockReturnValueOnce({ toArray: async () => [] });

    db.collection("shareListings");
    db.collectionMocks["shareListings"].find.mockReturnValueOnce({ toArray: async () => [] });

    const { debitShares } = await import("@/lib/corporations/shareholderOps");

    const { POST } = await import("./route");
    const req = new Request("http://localhost/api/corporations/abc/shares/listings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ shares: 100, sellAsCorporation: false }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: "abc" }) });
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json.requiresCeoVacateConfirm).toBe(true);
    expect(json.error).toContain("Acme");
    expect(json.error).toMatch(/CEO/i);
    expect(debitShares).not.toHaveBeenCalled();
    expect(db.collectionMocks["shareListings"].insertOne).not.toHaveBeenCalled();
  });

  it("does not require confirmation for a partial listing by the CEO", async () => {
    const userId = new ObjectId();
    const charId = new ObjectId();
    const corpId = new ObjectId();

    const { requireBasicAuth } = await import("@/lib/api/requireAuth");
    vi.mocked(requireBasicAuth).mockResolvedValue({
      ok: true,
      user: { userId: userId.toString() },
    } as any);

    const { getCharacterByUserId } = await import("@/lib/db/characterLookup");
    vi.mocked(getCharacterByUserId).mockResolvedValue({
      _id: charId,
      userId,
      name: "CEO Seller",
    } as any);

    db.collection("gameState");
    db.collectionMocks["gameState"].findOne.mockResolvedValue({ _id: "current", currentTurn: 42 });

    const { resolveCorporation } = await import("@/lib/api/corporations/resolveQuery");
    vi.mocked(resolveCorporation).mockResolvedValue({
      ok: true,
      corporation: {
        _id: corpId,
        sharePrice: 10,
        totalShares: 1000,
        // CEO owns 100 shares but only lists 30 — should not vacate or require confirm.
        shareholders: [{ characterId: charId, shares: 100 }],
        ceoId: charId,
        userId,
      },
    } as any);

    db.collection("shareOrders");
    db.collectionMocks["shareOrders"].find.mockReturnValueOnce({ toArray: async () => [] });

    db.collection("shareListings");
    db.collectionMocks["shareListings"].find.mockReturnValueOnce({ toArray: async () => [] });
    db.collectionMocks["shareListings"].insertOne.mockResolvedValue({
      acknowledged: true,
      insertedId: new ObjectId(),
    });

    const { debitShares } = await import("@/lib/corporations/shareholderOps");
    vi.mocked(debitShares).mockResolvedValueOnce(70);

    const { POST } = await import("./route");
    const req = new Request("http://localhost/api/corporations/abc/shares/listings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ shares: 30, sellAsCorporation: false }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: "abc" }) });

    expect(res.status).toBe(200);
    expect(debitShares).toHaveBeenCalledWith(
      expect.anything(),
      corpId,
      charId,
      30,
      expect.objectContaining({
        $set: expect.not.objectContaining({ ceoVacant: true }),
      }),
      { requireSufficient: true }
    );
  });

  it("stamps expiresAtTurn on character listings so read/submit/expiry agree", async () => {
    // Regression: character listings previously set only the wall-clock
    // expiresAt. The seller's listing read filtered on expiresAt while the
    // offer-submit guard and turn processor used expiresAtTurn — so a listing
    // that was wall-clock-expired but turn-alive accepted offers the seller
    // could never see. Character listings must carry the turn anchor too.
    const userId = new ObjectId();
    const charId = new ObjectId();
    const corpId = new ObjectId();

    const { requireBasicAuth } = await import("@/lib/api/requireAuth");
    vi.mocked(requireBasicAuth).mockResolvedValue({
      ok: true,
      user: { userId: userId.toString() },
    } as any);

    const { getCharacterByUserId } = await import("@/lib/db/characterLookup");
    vi.mocked(getCharacterByUserId).mockResolvedValue({
      _id: charId,
      userId,
      name: "Seller",
    } as any);

    db.collection("gameState");
    db.collectionMocks["gameState"].findOne.mockResolvedValue({ _id: "current", currentTurn: 42 });

    const { resolveCorporation } = await import("@/lib/api/corporations/resolveQuery");
    vi.mocked(resolveCorporation).mockResolvedValue({
      ok: true,
      corporation: {
        _id: corpId,
        sharePrice: 10,
        totalShares: 1000,
        // Not the CEO and not selling the full stake → no CEO-vacate branch.
        shareholders: [{ characterId: charId, shares: 100 }],
        ceoId: new ObjectId(),
      },
    } as any);

    db.collection("shareOrders");
    db.collectionMocks["shareOrders"].find.mockReturnValueOnce({ toArray: async () => [] });

    db.collection("shareListings");
    db.collectionMocks["shareListings"].find.mockReturnValueOnce({ toArray: async () => [] });
    db.collectionMocks["shareListings"].insertOne.mockResolvedValue({
      acknowledged: true,
      insertedId: new ObjectId(),
    });

    const { debitShares } = await import("@/lib/corporations/shareholderOps");
    vi.mocked(debitShares).mockResolvedValueOnce(0);

    const { POST } = await import("./route");
    const req = new Request("http://localhost/api/corporations/abc/shares/listings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ shares: 50, sellAsCorporation: false }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: "abc" }) });

    expect(res.status).toBe(200);
    expect(db.collectionMocks["shareListings"].insertOne).toHaveBeenCalledWith(
      expect.objectContaining({
        sellerCharacterId: charId,
        // 42 (current turn) + 24 (LISTING_TTL_TURNS)
        expiresAtTurn: 66,
        expiresAt: expect.any(Date),
      })
    );
  });

  it("restores shares and CEO state if post-insert cleanup fails", async () => {
    const userId = new ObjectId();
    const charId = new ObjectId();
    const corpId = new ObjectId();

    const { requireBasicAuth } = await import("@/lib/api/requireAuth");
    vi.mocked(requireBasicAuth).mockResolvedValue({
      ok: true,
      user: { userId: userId.toString() },
    } as any);

    const { getCharacterByUserId } = await import("@/lib/db/characterLookup");
    vi.mocked(getCharacterByUserId).mockResolvedValue({
      _id: charId,
      userId,
      name: "CEO Seller",
    } as any);

    db.collection("gameState");
    db.collectionMocks["gameState"].findOne.mockResolvedValue({ _id: "current", currentTurn: 42 });

    const { resolveCorporation } = await import("@/lib/api/corporations/resolveQuery");
    vi.mocked(resolveCorporation).mockResolvedValue({
      ok: true,
      corporation: {
        _id: corpId,
        sharePrice: 10,
        totalShares: 1000,
        shareholders: [{ characterId: charId, shares: 100, avgCostPerShare: 7 }],
        ceoId: charId,
        userId,
      },
    } as any);

    db.collection("shareOrders");
    db.collectionMocks["shareOrders"].find.mockReturnValueOnce({ toArray: async () => [] });

    db.collection("shareListings");
    db.collectionMocks["shareListings"].find.mockReturnValueOnce({ toArray: async () => [] });
    db.collectionMocks["shareListings"].insertOne.mockResolvedValue({
      acknowledged: true,
      insertedId: new ObjectId(),
    });
    db.collectionMocks["shareListings"].deleteOne.mockResolvedValue({ deletedCount: 1 });
    db.collection("corporationCeoVotes");
    db.collectionMocks["corporationCeoVotes"].deleteMany.mockRejectedValueOnce(
      new Error("cleanup failed")
    );
    db.collection("corporations");

    const { debitShares, creditShares } = await import("@/lib/corporations/shareholderOps");
    vi.mocked(debitShares).mockResolvedValueOnce(0);

    const { POST } = await import("./route");
    const req = new Request("http://localhost/api/corporations/abc/shares/listings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ shares: 100, sellAsCorporation: false, confirmCeoVacate: true }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: "abc" }) });

    expect(res.status).toBe(500);
    expect(db.collectionMocks["shareListings"].deleteOne).toHaveBeenCalledTimes(1);
    expect(creditShares).toHaveBeenCalledWith(
      expect.anything(),
      corpId,
      charId,
      100,
      expect.anything(),
      { pricePerShare: 7 }
    );
    expect(db.collectionMocks["corporations"].updateOne).toHaveBeenCalledWith(
      { _id: corpId },
      expect.objectContaining({
        $set: expect.objectContaining({
          ceoId: charId,
          userId,
          ceoVacant: false,
        }),
      })
    );
  });
});

describe("GET /api/corporations/[id]/shares/listings", () => {
  it("queries with a turn-first $or filter, not a wall-clock-only filter (ticket #0859)", async () => {
    // Regression: the read previously filtered on `expiresAt: { $gt: now }`
    // alone. A listing that was wall-clock-expired but turn-alive (slow
    // turns, or a paused game) accepted offers via the turn-first submit
    // guard, but never showed up here — the seller saw "No offers yet" and
    // could never accept. Assert the query shape so a future edit can't
    // silently drop back to a Date-only filter.
    const userId = new ObjectId();
    const charId = new ObjectId();
    const corpId = new ObjectId();

    const { requireBasicAuth } = await import("@/lib/api/requireAuth");
    vi.mocked(requireBasicAuth).mockResolvedValue({
      ok: true,
      user: { userId: userId.toString() },
    } as any);

    const { getCharacterByUserId } = await import("@/lib/db/characterLookup");
    vi.mocked(getCharacterByUserId).mockResolvedValue({
      _id: charId,
      userId,
      name: "Seller",
    } as any);

    const { resolveCorporation } = await import("@/lib/api/corporations/resolveQuery");
    vi.mocked(resolveCorporation).mockResolvedValue({
      ok: true,
      corporation: { _id: corpId },
    } as any);

    db.collection("gameState");
    db.collectionMocks["gameState"].findOne.mockResolvedValue({ _id: "current", currentTurn: 50 });

    db.collection("shareListings");
    db.collectionMocks["shareListings"].find.mockReturnValueOnce({
      sort: () => ({ toArray: async () => [] }),
    });

    const { GET } = await import("./route");
    const req = new Request("http://localhost/api/corporations/abc/shares/listings");
    const res = await GET(req, { params: Promise.resolve({ id: "abc" }) });

    expect(res.status).toBe(200);
    expect(db.collectionMocks["shareListings"].find).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "open",
        $or: [
          { expiresAtTurn: { $gt: 50 } },
          { expiresAtTurn: { $exists: false }, expiresAt: { $gt: expect.any(Date) } },
        ],
      })
    );
  });
});
