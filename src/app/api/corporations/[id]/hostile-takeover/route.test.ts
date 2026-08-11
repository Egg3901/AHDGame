import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireCorporationActions", () => ({
  requireCorporationActionsEnabled: vi.fn(),
}));
vi.mock("@/lib/api/requireAuth", () => ({ requireBasicAuth: vi.fn() }));
vi.mock("@/lib/api/validate", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/validate")>();
  return { ...actual, parseJsonBody: vi.fn() };
});
vi.mock("@/lib/api/corporations/resolveQuery", () => ({
  corporationQueryFromParamId: vi.fn(),
  resolveCorporation: vi.fn(),
  requireCeo: vi.fn(),
}));
vi.mock("@/lib/api/rateLimit", () => ({
  checkRateLimit: vi.fn(),
  rateLimitResponse: vi.fn(),
}));
vi.mock("@/lib/currency/featureFlag", () => ({ isForexEnabled: vi.fn() }));
vi.mock("@/lib/corporations/corporateOwnership", () => ({
  acquirerOwnershipPercent: vi.fn(),
  HOSTILE_TAKEOVER_OWNERSHIP_THRESHOLD_PERCENT: 50,
  HOSTILE_TAKEOVER_PREMIUM_RATE: 0.25,
}));
vi.mock("@/lib/currency/characterFunds", () => ({
  buildPersonalBalanceInc: vi.fn(() => ({})),
  getHomeCurrency: vi.fn(() => "USD"),
  loadCharacterFxRate: vi.fn(),
}));
vi.mock("@/lib/currency/corporationCapital", () => ({
  anchorToCorpLiquidCapital: vi.fn((value: number) => value),
  corpLiquidCapitalToAnchor: vi.fn((value: number) => value),
  loadFxRatesByCurrency: vi.fn().mockResolvedValue(new Map()),
  fxRateForCorpFromMap: vi.fn().mockReturnValue(1),
  resolveCorpLiquidCurrencyCode: vi.fn(() => "USD"),
}));
vi.mock("@/lib/currency/marketMaker", () => ({ safeDistributeConversionSpread: vi.fn() }));
vi.mock("@/lib/corporations/shareTradeHistory", () => ({ recordShareTrade: vi.fn() }));
vi.mock("@/lib/turn/currentTurn", () => ({ getCurrentTurn: vi.fn() }));

let db: MockDb;

function makeCursor(docs: unknown[]) {
  return {
    toArray: vi.fn().mockResolvedValue(docs),
    sort: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    skip: vi.fn().mockReturnThis(),
    project: vi.fn().mockReturnThis(),
  };
}

beforeEach(() => {
  db = createMockDb();
  vi.clearAllMocks();
  db.collection("corporations");
  db.collection("corporateSectors");
  db.collection("states");
  db.collection("bonds");
  db.collection("shareOrders");
  db.collection("shareListings");
});

describe("POST /api/corporations/[id]/hostile-takeover", () => {
  it("normalizes the keeper countryId when a stale parent sector absorbs a correct target sector", async () => {
    const parentId = new ObjectId();
    const targetId = new ObjectId();
    const parentSectorId = new ObjectId();
    const targetSectorId = new ObjectId();

    const parent = {
      _id: parentId,
      name: "Parent Corp",
      liquidCapital: 1_000_000,
      shareholders: [],
    };
    const target = {
      _id: targetId,
      name: "Target Corp",
      liquidCapital: 0,
      sharePrice: 10,
      shareholders: [{ corporationId: parentId, shares: 60 }],
      liquidCurrencyCode: "USD",
    };

    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as import("mongodb").Db);

    const { requireBasicAuth } = await import("@/lib/api/requireAuth");
    vi.mocked(requireBasicAuth).mockResolvedValue({
      ok: true,
      user: { userId: "user-1" },
    } as never);

    const { parseJsonBody } = await import("@/lib/api/validate");
    vi.mocked(parseJsonBody).mockResolvedValue({
      success: true,
      data: { parentCorporationId: parentId.toString() },
    } as never);

    const { requireCorporationActionsEnabled } =
      await import("@/lib/api/requireCorporationActions");
    vi.mocked(requireCorporationActionsEnabled).mockResolvedValue(null);

    const { corporationQueryFromParamId, resolveCorporation, requireCeo } =
      await import("@/lib/api/corporations/resolveQuery");
    vi.mocked(corporationQueryFromParamId).mockReturnValue({ _id: parentId } as never);
    vi.mocked(resolveCorporation).mockResolvedValue({ ok: true, corporation: target } as never);
    vi.mocked(requireCeo).mockReturnValue(null);

    const { checkRateLimit } = await import("@/lib/api/rateLimit");
    vi.mocked(checkRateLimit).mockReturnValue({
      ok: true,
      limit: 100,
      remaining: 99,
      resetAt: Date.now() + 60_000,
    });

    const { isForexEnabled } = await import("@/lib/currency/featureFlag");
    vi.mocked(isForexEnabled).mockResolvedValue(false);

    const { acquirerOwnershipPercent } = await import("@/lib/corporations/corporateOwnership");
    vi.mocked(acquirerOwnershipPercent).mockReturnValue(60);

    const { getCurrentTurn } = await import("@/lib/turn/currentTurn");
    vi.mocked(getCurrentTurn).mockResolvedValue(123);

    db.collectionMocks.corporations.findOne.mockResolvedValue(parent as never);
    db.collectionMocks.bonds.countDocuments.mockResolvedValue(0);

    db.collectionMocks.corporateSectors.find
      .mockReturnValueOnce(
        makeCursor([
          {
            _id: targetSectorId,
            corporationId: targetId,
            countryId: "UK",
            stateId: "LON",
            sectorType: "energy",
            revenue: 100,
            workers: 10,
            profitMargin: 40,
          },
        ])
      )
      .mockReturnValueOnce(
        makeCursor([
          {
            _id: parentSectorId,
            corporationId: parentId,
            countryId: "US",
            stateId: "LON",
            sectorType: "energy",
            revenue: 900,
            workers: 90,
            profitMargin: 20,
          },
        ])
      );

    db.collectionMocks.states.find.mockReturnValue(makeCursor([{ _id: "LON", countryId: "UK" }]));

    db.collectionMocks.corporations.find.mockReturnValue(makeCursor([]));

    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://localhost/api/corporations/target/hostile-takeover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parentCorporationId: parentId.toString() }),
      }),
      { params: Promise.resolve({ id: targetId.toString() }) }
    );

    expect(response.status).toBe(200);

    const bulkOps = db.collectionMocks.corporateSectors.bulkWrite.mock.calls[0]?.[0] as Array<{
      updateOne: { update: { $set: Record<string, unknown> } };
    }>;
    expect(bulkOps).toHaveLength(1);
    expect(bulkOps[0]?.updateOne.update.$set.countryId).toBe("UK");
  });
});
