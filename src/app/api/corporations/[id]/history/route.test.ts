import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/gameState", () => ({
  getGameState: vi.fn(),
}));
vi.mock("@/lib/api/corporations/resolveQuery", () => ({
  resolveCorporation: vi.fn(),
}));

let db: MockDb;

beforeEach(async () => {
  db = createMockDb();
  vi.clearAllMocks();
  db.collection("corporationHistory");

  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as any);

  const { getGameState } = await import("@/lib/gameState");
  vi.mocked(getGameState).mockResolvedValue({ currentTurn: 469 } as any);
});

describe("GET /api/corporations/[id]/history", () => {
  it("queries the newest 500 unique turns in chronological order", async () => {
    const corpId = new ObjectId();
    const { resolveCorporation } = await import("@/lib/api/corporations/resolveQuery");
    vi.mocked(resolveCorporation).mockResolvedValue({
      ok: true,
      corporation: {
        _id: corpId,
        sequentialId: 16,
        sharePrice: 100,
        totalShares: 1_000,
        liquidCapital: 50_000,
        marketingStrength: 30,
        dividendRate: 4,
        liquidCurrencyCode: "USD",
      } as any,
    } as any);

    db.collectionMocks.corporationHistory.aggregate.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });

    const { GET } = await import("./route");
    const res = await GET(new Request("http://localhost/api/corporations/16/history"), {
      params: Promise.resolve({ id: "16" }),
    });

    expect(res.status).toBe(200);
    expect(db.collectionMocks.corporationHistory.aggregate).toHaveBeenCalledTimes(1);

    const [pipeline] = db.collectionMocks.corporationHistory.aggregate.mock.calls[0] as [
      Array<Record<string, unknown>>,
    ];
    expect(pipeline).toEqual([
      { $match: { corporationId: corpId } },
      { $sort: { turn: -1, createdAt: -1, _id: -1 } },
      { $group: { _id: "$turn", doc: { $first: "$$ROOT" } } },
      { $replaceRoot: { newRoot: "$doc" } },
      { $sort: { turn: -1 } },
      { $limit: 500 },
      { $sort: { turn: 1 } },
      {
        $project: {
          _id: 0,
          turn: 1,
          sharePrice: 1,
          marketCap: 1,
          liquidCapital: 1,
          revenue: 1,
          totalCosts: 1,
          income: 1,
          incomePreDividends: 1,
          dividendPaidPerTurn: 1,
          corporateTaxPaid: 1,
          federalTaxPaid: 1,
          stateTaxPaid: 1,
          perTurnBondCouponIncome: 1,
          perTurnBondDragOnNetIncome: 1,
          taxPaidByCountry: 1,
          taxPaidByState: 1,
          taxPaidByCountryDomestic: 1,
          taxPaidByCountryForeign: 1,
          taxPaidByStateDomestic: 1,
          taxPaidByStateForeign: 1,
          marketingStrength: 1,
          dividendRate: 1,
          creditComposite: 1,
          creditRating: 1,
          marginDiagnostic: 1,
          currencyCode: 1,
          fxRateAtWrite: 1,
          totalShares: 1,
          brandLoyalty: 1,
          averageQuality: 1,
          commodityOutput: 1,
          createdAt: 1,
        },
      },
    ]);
  });

  it("full=1 downsamples the entire history with a turn-rank stride, keeping the newest", async () => {
    const corpId = new ObjectId();
    const { resolveCorporation } = await import("@/lib/api/corporations/resolveQuery");
    vi.mocked(resolveCorporation).mockResolvedValue({
      ok: true,
      corporation: {
        _id: corpId,
        sequentialId: 16,
        sharePrice: 100,
        totalShares: 1_000,
        liquidCapital: 50_000,
        marketingStrength: 30,
        dividendRate: 4,
        liquidCurrencyCode: "USD",
      } as any,
    } as any);

    // First aggregate call counts the distinct-turn snapshots; second returns rows.
    db.collectionMocks.corporationHistory.aggregate
      .mockReturnValueOnce({ toArray: vi.fn().mockResolvedValue([{ n: 1200 }]) })
      .mockReturnValueOnce({ toArray: vi.fn().mockResolvedValue([]) });

    const { GET } = await import("./route");
    const res = await GET(new Request("http://localhost/api/corporations/16/history?full=1"), {
      params: Promise.resolve({ id: "16" }),
    });

    expect(res.status).toBe(200);
    expect(db.collectionMocks.corporationHistory.aggregate).toHaveBeenCalledTimes(2);

    const [mainPipeline] = db.collectionMocks.corporationHistory.aggregate.mock.calls[1] as [
      Array<Record<string, unknown>>,
    ];
    // stride = ceil(1200 / 500) = 3
    expect(mainPipeline).toContainEqual({
      $setWindowFields: { sortBy: { turn: 1 }, output: { _rank: { $documentNumber: {} } } },
    });
    expect(mainPipeline).toContainEqual({
      $match: {
        $expr: {
          $or: [
            { $eq: [{ $mod: [{ $subtract: ["$_rank", 1] }, 3] }, 0] },
            { $eq: ["$_rank", 1200] },
          ],
        },
      },
    });
    // The recent-window cap must NOT be present in the full-range pipeline.
    expect(mainPipeline).not.toContainEqual({ $limit: 500 });
  });

  it("overwrites the latest row's market cap with the live quote (#963) but leaves other fields as the stored snapshot", async () => {
    const corpId = new ObjectId();
    const { resolveCorporation } = await import("@/lib/api/corporations/resolveQuery");
    vi.mocked(resolveCorporation).mockResolvedValue({
      ok: true,
      corporation: {
        _id: corpId,
        sequentialId: 16,
        sharePrice: 125.55,
        totalShares: 1_000,
        liquidCapital: 88_888,
        marketingStrength: 42.25,
        dividendRate: 6,
        liquidCurrencyCode: "USD",
      } as any,
    } as any);

    db.collectionMocks.corporationHistory.aggregate.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        {
          turn: 468,
          sharePrice: 99,
          marketCap: 99_000,
          liquidCapital: 40_000,
          revenue: 500,
          totalCosts: 350,
          income: 150,
          marketingStrength: 30,
          dividendRate: 5,
          currencyCode: "USD",
          totalShares: 1_000,
          createdAt: new Date("2026-04-30T14:00:00Z"),
        },
        {
          turn: 469,
          sharePrice: 101,
          marketCap: 101_000,
          liquidCapital: 41_000,
          revenue: 510,
          totalCosts: 351,
          income: 159,
          marketingStrength: 31,
          dividendRate: 5,
          currencyCode: "USD",
          totalShares: 1_000,
          createdAt: new Date("2026-04-30T15:00:00Z"),
        },
      ]),
    });

    const { GET } = await import("./route");
    const res = await GET(new Request("http://localhost/api/corporations/16/history"), {
      params: Promise.resolve({ id: "16" }),
    });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.history).toHaveLength(2);
    // marketCap on the latest row is overwritten with the live sharePrice * totalShares
    // (getRoundedPublicMarketCap) so the Charts tab's "current" figure always matches
    // the Overview card, instead of staying frozen at whatever snapshotMarketCap()
    // wrote last turn (#963). Every other field — and the older turn-468 row — is
    // untouched.
    expect(json.history[1]).toMatchObject({
      turn: 469,
      sharePrice: 101,
      marketCap: 125_550,
      liquidCapital: 41_000,
      marketingStrength: 31,
      dividendRate: 5,
      currencyCode: "USD",
      revenue: 510,
      totalCosts: 351,
      income: 159,
    });
    expect(json.history[1].fxRateAtWrite).toBeUndefined();
    expect(json.history[1].totalShares).toBeUndefined();
    expect(json.history[1].createdAt).toBeUndefined();
    expect(json.history[0]).toMatchObject({ turn: 468, marketCap: 99_000 });
  });

  it("overwrites the latest row's market cap with the live quote even when the current turn has no snapshot yet", async () => {
    const corpId = new ObjectId();
    const { resolveCorporation } = await import("@/lib/api/corporations/resolveQuery");
    vi.mocked(resolveCorporation).mockResolvedValue({
      ok: true,
      corporation: {
        _id: corpId,
        sequentialId: 16,
        sharePrice: 222.22,
        totalShares: 1_000,
        liquidCapital: 99_999,
        marketingStrength: 55,
        dividendRate: 7,
        liquidCurrencyCode: "USD",
      } as any,
    } as any);

    const { getGameState } = await import("@/lib/gameState");
    vi.mocked(getGameState).mockResolvedValue({ currentTurn: 470 } as any);

    db.collectionMocks.corporationHistory.aggregate.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        {
          turn: 468,
          sharePrice: 99,
          marketCap: 99_000,
          liquidCapital: 40_000,
          revenue: 500,
          totalCosts: 350,
          income: 150,
          marketingStrength: 30,
          dividendRate: 5,
          currencyCode: "USD",
          totalShares: 1_000,
          createdAt: new Date("2026-04-30T14:00:00Z"),
        },
        {
          turn: 469,
          sharePrice: 101,
          marketCap: 101_000,
          liquidCapital: 41_000,
          revenue: 510,
          totalCosts: 351,
          income: 159,
          marketingStrength: 31,
          dividendRate: 5,
          currencyCode: "USD",
          totalShares: 1_000,
          createdAt: new Date("2026-04-30T15:00:00Z"),
        },
      ]),
    });

    const { GET } = await import("./route");
    const res = await GET(new Request("http://localhost/api/corporations/16/history"), {
      params: Promise.resolve({ id: "16" }),
    });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.history[1]).toMatchObject({
      turn: 469,
      sharePrice: 101,
      marketCap: 222_220,
      liquidCapital: 41_000,
      marketingStrength: 31,
      dividendRate: 5,
      currencyCode: "USD",
    });
  });
});
