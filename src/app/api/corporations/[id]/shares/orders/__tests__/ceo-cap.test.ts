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
vi.mock("@/lib/db/characterLookup", () => ({ getCharacterByUserId: vi.fn() }));

let db: MockDb;
const userId = new ObjectId();
const ceoId = new ObjectId();
const corpId = new ObjectId();

beforeEach(async () => {
  vi.clearAllMocks();
  db = createMockDb();
  for (const n of ["shareTradeHistory", "shareOrders", "shareOffers", "gameState"])
    db.collection(n);
  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
  const { requireBasicAuth } = await import("@/lib/api/requireAuth");
  vi.mocked(requireBasicAuth).mockResolvedValue({
    ok: true,
    user: { userId: userId.toString() },
  } as never);
  const { getCharacterByUserId } = await import("@/lib/db/characterLookup");
  vi.mocked(getCharacterByUserId).mockResolvedValue({
    _id: ceoId,
    userId,
    countryId: "US",
  } as never);
  db.collectionMocks["gameState"]!.findOne.mockResolvedValue({ _id: "current", currentTurn: 200 });
  db.collectionMocks["shareOrders"]!.find = (() => ({ toArray: async () => [] })) as never;
  db.collectionMocks["shareOffers"]!.find = (() => ({ toArray: async () => [] })) as never;
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

describe("placeShareOrder — CEO self-acquisition cap", () => {
  it("blocks a CEO buy order that exceeds the cap", async () => {
    const { placeShareOrder } =
      await import("@/lib/corporations/commands/shareTrading/placeShareOrder");
    const req = new Request("http://localhost/x", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "buy", shares: 20_000, pricePerShare: 1 }),
    });
    const res = await placeShareOrder(req, { params: Promise.resolve({ id: corpId.toString() }) });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("per 120 turns");
  });
});
