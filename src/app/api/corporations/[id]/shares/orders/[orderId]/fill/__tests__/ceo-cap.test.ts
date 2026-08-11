import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import type { Db } from "mongodb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireBasicAuth: vi.fn() }));
vi.mock("@/lib/api/requireCorporationActions", () => ({
  requireCorporationActionsEnabled: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/lib/api/rateLimit", () => ({
  checkRateLimit: vi.fn().mockReturnValue({ ok: true }),
  rateLimitResponse: vi.fn(),
}));
vi.mock("@/lib/currency/featureFlag", () => ({ isForexEnabled: vi.fn().mockResolvedValue(false) }));
vi.mock("@/lib/api/corporations/resolveQuery", () => ({ resolveCorporation: vi.fn() }));
vi.mock("@/lib/corporations/commands/privatization/openVoteGuard", () => ({
  assertCeoTradeNotBlocked: vi.fn().mockResolvedValue({ blocked: false }),
}));

let db: MockDb;
const userId = new ObjectId();
const ceoId = new ObjectId();
const sellerId = new ObjectId();
const corpId = new ObjectId();
const orderId = new ObjectId();

beforeEach(async () => {
  vi.clearAllMocks();
  db = createMockDb();
  for (const n of [
    "shareTradeHistory",
    "shareOrders",
    "shareOffers",
    "characters",
    "users",
    "gameState",
  ]) {
    db.collection(n);
  }
  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
  const { requireBasicAuth } = await import("@/lib/api/requireAuth");
  vi.mocked(requireBasicAuth).mockResolvedValue({
    ok: true,
    user: { userId: userId.toString() },
  } as never);
  db.collectionMocks["users"]!.findOne.mockResolvedValue({ _id: userId, activeCharacterId: ceoId });
  db.collectionMocks["characters"]!.findOne.mockResolvedValue({
    _id: ceoId,
    userId,
    countryId: "US",
    name: "CEO",
  });
  db.collectionMocks["gameState"]!.findOne.mockResolvedValue({ _id: "current", currentTurn: 200 });
  // Filling a SELL order → the CEO acquires; over-cap history.
  db.collectionMocks["shareOrders"]!.findOne.mockResolvedValue({
    _id: orderId,
    type: "sell",
    status: "open",
    corporationId: corpId,
    characterId: sellerId,
    sharesRemaining: 50_000,
    pricePerShare: 1,
  });
  db.collectionMocks["shareOrders"]!.find = (() => ({ toArray: async () => [] })) as never;
  db.collectionMocks["shareOffers"]!.find = (() => ({ toArray: async () => [] })) as never;
  db.collectionMocks["shareTradeHistory"]!.find = (() => ({
    toArray: async () => [{ shares: 95_000, turn: 130 }],
  })) as never;
  const { resolveCorporation } = await import("@/lib/api/corporations/resolveQuery");
  vi.mocked(resolveCorporation).mockResolvedValue({
    ok: true,
    corporation: { _id: corpId, name: "TickerCo", ceoId, totalShares: 1_000_000 },
  } as never);
});

describe("fillShareOrder — CEO self-acquisition cap", () => {
  it("blocks a CEO filling a sell order beyond the cap", async () => {
    const { fillShareOrder } =
      await import("@/lib/corporations/commands/shareTrading/fillShareOrder");
    const req = new Request("http://localhost/x", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ shares: 20_000 }),
    });
    const res = await fillShareOrder(req, {
      params: Promise.resolve({ id: corpId.toString(), orderId: orderId.toString() }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("per 120 turns");
  });
});
