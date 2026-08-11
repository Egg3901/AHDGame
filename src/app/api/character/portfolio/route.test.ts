import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({
  requireBasicAuth: vi.fn(),
}));
vi.mock("@/lib/gameState", () => ({
  getGameState: vi.fn(),
}));
vi.mock("@/lib/corporations/marketQuote", () => ({
  getPublicShareQuote: vi.fn().mockImplementation((corp: any) => corp.sharePrice || 100),
}));
vi.mock("@/lib/bonds/sovereign", () => ({
  getBondIssuerDisplayName: vi.fn().mockReturnValue("Test Issuer"),
  isCorporateBond: vi.fn().mockReturnValue(true),
}));
vi.mock("@/lib/constants/bonds", () => ({
  perTurnCouponPayment: vi.fn().mockReturnValue(5),
}));

let db: MockDb;

beforeEach(() => {
  db = createMockDb();
  vi.clearAllMocks();
  // Pre-initialize collections
  db.collection("characters");
  db.collection("corporations");
  db.collection("bonds");
  db.collection("portfolioHistory");
});

async function setup() {
  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as any);
}

function makeBasicAuth(userId: string) {
  return { ok: true, user: { userId } };
}

describe("GET /api/character/portfolio", () => {
  it("returns 401 when not authenticated", async () => {
    await setup();
    const { requireBasicAuth } = await import("@/lib/api/requireAuth");
    vi.mocked(requireBasicAuth).mockResolvedValue({
      ok: false,
      response: new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }),
    } as never);

    const { GET } = await import("./route");
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("returns empty portfolio when character has no holdings", async () => {
    await setup();
    const userId = new ObjectId().toString();
    const { requireBasicAuth } = await import("@/lib/api/requireAuth");
    vi.mocked(requireBasicAuth).mockResolvedValue(makeBasicAuth(userId) as never);

    const { getGameState } = await import("@/lib/gameState");
    vi.mocked(getGameState).mockResolvedValue({ currentTurn: 1 } as any);

    db.collectionMocks.characters.findOne.mockResolvedValue(null);

    const { GET } = await import("./route");
    const res = await GET();
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.holdings).toEqual([]);
    expect(data.bondHoldings).toEqual([]);
    expect(data.totalValue).toBe(0);
    expect(data.totalBondValue).toBe(0);
  });

  it("calculates stock holdings with unrealized P&L", async () => {
    await setup();
    const userId = new ObjectId().toString();
    const charId = new ObjectId();
    const corpId = new ObjectId();

    const { requireBasicAuth } = await import("@/lib/api/requireAuth");
    vi.mocked(requireBasicAuth).mockResolvedValue(makeBasicAuth(userId) as never);

    const { getGameState } = await import("@/lib/gameState");
    vi.mocked(getGameState).mockResolvedValue({ currentTurn: 100 } as any);

    db.collectionMocks.characters.findOne.mockResolvedValue({
      _id: charId,
      userId: new ObjectId(userId),
      cashOnHand: 5000,
    });

    db.collectionMocks.corporations.find.mockReturnValue({
      project: () => ({
        toArray: async () => [
          {
            _id: corpId,
            name: "Test Corp",
            sequentialId: 1,
            sharePrice: 100,
            logoUrl: "logo.png",
            brandColor: "#ff0000",
            shareholders: [{ characterId: charId, shares: 50, avgCostPerShare: 80 }],
          },
        ],
      }),
    });

    db.collectionMocks.bonds.find.mockReturnValue({ toArray: async () => [] });
    db.collectionMocks.portfolioHistory.find.mockReturnValue({
      sort: () => ({
        limit: (n: number) => ({
          project: () => ({
            toArray: async () => [],
            next: async () => (n === 1 ? null : undefined),
          }),
        }),
      }),
    });

    const { GET } = await import("./route");
    const res = await GET();
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.holdings).toHaveLength(1);
    expect(data.holdings[0]).toMatchObject({
      corporationName: "Test Corp",
      shares: 50,
      sharePrice: 100,
      totalValue: 5000,
      avgCostPerShare: 80,
      unrealizedPnl: 1000, // (100 - 80) * 50 = 1000
      unrealizedPnlPct: 25, // (100-80)/80 * 100 = 25%
    });
    expect(data.totalValue).toBe(5000);
    expect(data.cashOnHand).toBe(5000);
  });

  it("calculates bond holdings with coupon income", async () => {
    await setup();
    const userId = new ObjectId().toString();
    const charId = new ObjectId();
    const bondCorpId = new ObjectId();

    const { requireBasicAuth } = await import("@/lib/api/requireAuth");
    vi.mocked(requireBasicAuth).mockResolvedValue(makeBasicAuth(userId) as never);

    const { getGameState } = await import("@/lib/gameState");
    vi.mocked(getGameState).mockResolvedValue({ currentTurn: 100 } as any);

    db.collectionMocks.characters.findOne.mockResolvedValue({
      _id: charId,
      userId: new ObjectId(userId),
      cashOnHand: 10000,
    });

    db.collectionMocks.corporations.find.mockReturnValue({
      project: () => ({ toArray: async () => [] }),
    });

    db.collectionMocks.bonds.find.mockReturnValue({
      toArray: async () => [
        {
          _id: new ObjectId(),
          corporationId: bondCorpId,
          maturityTurns: 20,
          maturityTurn: 120,
          couponRate: 0.05,
          marketPrice: 1.0,
          defaulted: false,
          holders: [{ characterId: charId, units: 10 }],
        },
      ],
    });

    db.collectionMocks.corporations.findOne.mockResolvedValue({
      name: "Bond Corp",
      sequentialId: 5,
      brandColor: "#00ff00",
    });

    db.collectionMocks.portfolioHistory.find.mockReturnValue({
      sort: () => ({
        limit: () => ({
          project: () => ({
            toArray: async () => [],
            next: async () => null,
          }),
        }),
      }),
    });

    const { GET } = await import("./route");
    const res = await GET();
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.bondHoldings).toHaveLength(1);
    expect(data.bondHoldings[0]).toMatchObject({
      corporationName: "Test Issuer",
      units: 10,
      couponRate: 0.05,
      turnsRemaining: 20, // 120 - 100 = 20
      marketPrice: 1,
    });
    expect(data.totalBondIncomePerTurn).toBe(50); // 5 * 10 = 50
  });

  it("returns the most recent 500 history points (not the oldest) for long-lived characters", async () => {
    await setup();
    const userId = new ObjectId().toString();
    const charId = new ObjectId();

    const { requireBasicAuth } = await import("@/lib/api/requireAuth");
    vi.mocked(requireBasicAuth).mockResolvedValue(makeBasicAuth(userId) as never);

    const { getGameState } = await import("@/lib/gameState");
    vi.mocked(getGameState).mockResolvedValue({ currentTurn: 600 } as any);

    db.collectionMocks.characters.findOne.mockResolvedValue({
      _id: charId,
      userId: new ObjectId(userId),
      cashOnHand: 0,
    });

    db.collectionMocks.corporations.find.mockReturnValue({
      project: () => ({ toArray: async () => [] }),
    });
    db.collectionMocks.bonds.find.mockReturnValue({ toArray: async () => [] });

    // 600 turns of history; chart query (sort: -1, limit 500) should return
    // turns 101-600 reversed back to ascending. The earliestSnapshot query
    // (sort: 1, limit 1) should still anchor to turn 1 for capital-gains baseline.
    const allRecords = Array.from({ length: 600 }, (_, i) => ({
      turn: i + 1,
      totalValue: 1000 + i,
    }));
    db.collectionMocks.portfolioHistory.find.mockReturnValue({
      sort: (sortArgs: { turn: 1 | -1 }) => {
        const sorted = [...allRecords].sort((a, b) =>
          sortArgs.turn === 1 ? a.turn - b.turn : b.turn - a.turn
        );
        return {
          limit: (n: number) => {
            const slice = sorted.slice(0, n);
            return {
              project: () => ({
                toArray: async () => slice,
                next: async () => slice[0] ?? null,
              }),
            };
          },
        };
      },
    });

    const { GET } = await import("./route");
    const res = await GET();
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.history).toHaveLength(500);
    expect(data.history[0].turn).toBe(101);
    expect(data.history[data.history.length - 1].turn).toBe(600);
    // Capital-gains baseline still uses the oldest snapshot.
    expect(data.capitalGainsBaselineTurn).toBe(1);
  });

  it("calculates capital gains from portfolio history baseline", async () => {
    await setup();
    const userId = new ObjectId().toString();
    const charId = new ObjectId();

    const { requireBasicAuth } = await import("@/lib/api/requireAuth");
    vi.mocked(requireBasicAuth).mockResolvedValue(makeBasicAuth(userId) as never);

    const { getGameState } = await import("@/lib/gameState");
    vi.mocked(getGameState).mockResolvedValue({ currentTurn: 200 } as any);

    db.collectionMocks.characters.findOne.mockResolvedValue({
      _id: charId,
      userId: new ObjectId(userId),
      cashOnHand: 5000,
    });

    db.collectionMocks.corporations.find.mockReturnValue({
      project: () => ({
        toArray: async () => [
          {
            _id: new ObjectId(),
            name: "Growth Corp",
            sequentialId: 1,
            sharePrice: 150,
            shareholders: [{ characterId: charId, shares: 100, avgCostPerShare: 100 }],
          },
        ],
      }),
    });

    db.collectionMocks.bonds.find.mockReturnValue({ toArray: async () => [] });

    db.collectionMocks.portfolioHistory.find.mockReturnValue({
      sort: () => ({
        limit: (n: number) => ({
          project: () => ({
            toArray: async () => [],
            next: async () =>
              n === 1
                ? { turn: 50, totalValue: 8000, stockValue: 5000, bondValue: 3000, cashValue: 1000 }
                : null,
          }),
        }),
      }),
    });

    const { GET } = await import("./route");
    const res = await GET();
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.totalValue).toBe(15000); // 150 * 100
    expect(data.totalBondValue).toBe(0);
    expect(data.capitalGainsBaselineTurn).toBe(50);
    expect(data.totalCapitalGains).toBe(12000); // (15000 stocks + 5000 cash) - 8000 baseline
  });
});
