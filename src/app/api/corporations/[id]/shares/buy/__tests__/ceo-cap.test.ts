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

let db: MockDb;
const userId = new ObjectId();
const ceoId = new ObjectId();
const corpId = new ObjectId();

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
  });
  db.collectionMocks["gameState"]!.findOne.mockResolvedValue({ _id: "current", currentTurn: 200 });
  db.collectionMocks["shareOrders"]!.find = (() => ({ toArray: async () => [] })) as never;
  db.collectionMocks["shareOffers"]!.find = (() => ({ toArray: async () => [] })) as never;
  // CEO already acquired 95% of cap; a 20k-share buy (2%) over the 10% cap
  db.collectionMocks["shareTradeHistory"]!.find = (() => ({
    toArray: async () => [{ shares: 95_000, turn: 130 }],
  })) as never;
  const { resolveCorporation } = await import("@/lib/api/corporations/resolveQuery");
  vi.mocked(resolveCorporation).mockResolvedValue({
    ok: true,
    corporation: {
      _id: corpId,
      name: "TickerCo",
      ceoId,
      totalShares: 1_000_000,
      publicFloat: 500_000,
      sharePrice: 1,
      fundamentalSharePrice: 1,
    },
  } as never);
});

describe("buyPublicShares — CEO self-acquisition cap", () => {
  it("blocks a CEO float-buy that exceeds the 10%/120-turn cap", async () => {
    const { buyPublicShares } =
      await import("@/lib/corporations/commands/shareTrading/buyPublicShares");
    const req = new Request("http://localhost/x", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ shares: 20_000 }),
    });
    const res = await buyPublicShares(req, { params: Promise.resolve({ id: corpId.toString() }) });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("10% of TickerCo's shares per 120 turns");
  });
});
