import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn(), getMongoClient: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireBasicAuth: vi.fn() }));
vi.mock("@/lib/api/corporations/resolveQuery", () => ({
  resolveCorporation: vi.fn(),
  requireCeo: vi.fn(),
}));
vi.mock("@/lib/api/rateLimit", () => ({
  checkRateLimit: vi.fn(),
  rateLimitResponse: vi.fn(),
}));
vi.mock("@/lib/currency/featureFlag", () => ({
  isForexEnabled: vi.fn().mockResolvedValue(false),
}));
vi.mock("@/lib/corporations/cleanupShareMarketActivity", () => ({
  cleanupShareMarketActivityForCorporations: vi.fn().mockResolvedValue(undefined),
  cleanupShareMarketActivityForCorporationTargets: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/corporations/releaseHeldSharesToFloat", () => ({
  releaseCorporationHeldSharesToFloat: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/wireEvent", () => ({
  logWireEvent: vi.fn(),
  wireHeadlineCorpDissolved: vi.fn().mockReturnValue("Corp dissolved headline"),
}));

let db: MockDb;

beforeEach(() => {
  db = createMockDb();
  vi.clearAllMocks();
  db.collection("corporations");
  db.collection("bonds");
  db.collection("characters");
  db.collection("corporateSectors");
  db.collection("exchangeRates");
  db.collection("unownedSectors");
});

describe("POST /api/corporations/[id]/dissolve", () => {
  it("restores sector revenue in anchor units and deletes the sectors", async () => {
    const corpId = new ObjectId();
    const sectorId = new ObjectId();

    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as import("mongodb").Db);

    const { requireBasicAuth } = await import("@/lib/api/requireAuth");
    vi.mocked(requireBasicAuth).mockResolvedValue({
      ok: true,
      user: { userId: "user-1" },
    } as never);

    const { checkRateLimit } = await import("@/lib/api/rateLimit");
    vi.mocked(checkRateLimit).mockReturnValue({
      ok: true,
      limit: 100,
      remaining: 99,
      resetAt: Date.now() + 60_000,
    });

    const { resolveCorporation, requireCeo } = await import("@/lib/api/corporations/resolveQuery");
    vi.mocked(resolveCorporation).mockResolvedValue({
      ok: true,
      corporation: { _id: corpId, liquidCapital: 0, name: "Test Corp", isPrivate: true },
    } as never);
    vi.mocked(requireCeo).mockReturnValue(null);

    db.collectionMocks.corporations.findOne.mockResolvedValue({
      _id: corpId,
      ceoId: new ObjectId(),
      countryId: "UK",
      liquidCurrencyCode: "GBP",
      liquidCapital: 0,
      name: "Test Corp",
    });
    db.collectionMocks.corporateSectors.find.mockReturnValue({
      toArray: async () => [
        {
          _id: sectorId,
          corporationId: corpId,
          countryId: "UK",
          stateId: "LON",
          sectorType: "energy",
          revenue: 200,
        },
      ],
    });
    db.collectionMocks.corporations.find.mockReturnValue({
      project: vi.fn().mockReturnValue({
        toArray: async () => [{ _id: corpId, countryId: "UK", liquidCurrencyCode: "GBP" }],
      }),
      toArray: vi.fn().mockResolvedValue([]),
    });
    db.collectionMocks.exchangeRates.find.mockReturnValue({
      toArray: async () => [{ currencyCode: "GBP", rate: 2 }],
    });
    db.collectionMocks.unownedSectors.findOneAndUpdate.mockResolvedValue(null);
    db.collectionMocks.corporateSectors.deleteMany.mockResolvedValue({ deletedCount: 1 });
    db.collectionMocks.corporations.deleteOne.mockResolvedValue({ deletedCount: 1 });

    const { POST } = await import("./route");
    const response = await POST(new Request("http://localhost/api/corporations/1/dissolve"), {
      params: Promise.resolve({ id: "1" }),
    });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(db.collectionMocks.unownedSectors.findOneAndUpdate).toHaveBeenCalledTimes(1);
    expect(db.collectionMocks.corporateSectors.deleteMany).toHaveBeenCalledWith({
      _id: { $in: [sectorId] },
    });
  });

  it("returns 409 when a dissolve is already in progress", async () => {
    const corpId = new ObjectId();

    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as import("mongodb").Db);

    const { requireBasicAuth } = await import("@/lib/api/requireAuth");
    vi.mocked(requireBasicAuth).mockResolvedValue({
      ok: true,
      user: { userId: "user-1" },
    } as never);

    const { checkRateLimit } = await import("@/lib/api/rateLimit");
    vi.mocked(checkRateLimit).mockReturnValue({
      ok: true,
      limit: 100,
      remaining: 99,
      resetAt: Date.now() + 60_000,
    });

    const { resolveCorporation, requireCeo } = await import("@/lib/api/corporations/resolveQuery");
    vi.mocked(resolveCorporation).mockResolvedValue({
      ok: true,
      corporation: { _id: corpId, liquidCapital: 0, name: "Test Corp", isPrivate: true },
    } as never);
    vi.mocked(requireCeo).mockReturnValue(null);

    db.collectionMocks.bonds.countDocuments.mockResolvedValue(0);
    db.collectionMocks.corporations.updateOne.mockResolvedValue({
      matchedCount: 0,
      modifiedCount: 0,
    });

    const { POST } = await import("./route");
    const response = await POST(new Request("http://localhost/api/corporations/1/dissolve"), {
      params: Promise.resolve({ id: "1" }),
    });

    expect(response.status).toBe(409);
    expect(db.collectionMocks.characters.updateOne).not.toHaveBeenCalled();
  });

  it("blocks dissolution before the minimum corporation age", async () => {
    const corpId = new ObjectId();

    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as import("mongodb").Db);

    const { requireBasicAuth } = await import("@/lib/api/requireAuth");
    vi.mocked(requireBasicAuth).mockResolvedValue({
      ok: true,
      user: { userId: "user-1" },
    } as never);

    const { checkRateLimit } = await import("@/lib/api/rateLimit");
    vi.mocked(checkRateLimit).mockReturnValue({
      ok: true,
      limit: 100,
      remaining: 99,
      resetAt: Date.now() + 60_000,
    });

    const { resolveCorporation, requireCeo } = await import("@/lib/api/corporations/resolveQuery");
    // Founded this turn (gameState currentTurn defaults to 0) → too young.
    vi.mocked(resolveCorporation).mockResolvedValue({
      ok: true,
      corporation: {
        _id: corpId,
        liquidCapital: 0,
        name: "Fresh Corp",
        isPrivate: true,
        foundedAtTurn: 0,
      },
    } as never);
    vi.mocked(requireCeo).mockReturnValue(null);

    const { POST } = await import("./route");
    const response = await POST(new Request("http://localhost/api/corporations/1/dissolve"), {
      params: Promise.resolve({ id: "1" }),
    });
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toContain("too new");
    // Blocked before any settlement work.
    expect(db.collectionMocks.characters.updateOne).not.toHaveBeenCalled();
  });
});
