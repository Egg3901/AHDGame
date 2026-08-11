import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({
  requireAuth: vi.fn(),
}));
vi.mock("@/lib/gameState", () => ({
  getGameState: vi.fn(),
}));
vi.mock("@/lib/currency/featureFlag", () => ({
  isForexEnabled: vi.fn().mockResolvedValue(true),
}));
vi.mock("@/lib/corporations/marketQuote", () => ({
  getPublicShareQuote: vi.fn().mockImplementation((corp: any) => corp.sharePrice || 100),
}));
vi.mock("@/lib/bonds/sovereign", () => ({
  getBondIssuerDisplayName: vi.fn().mockReturnValue("Test Issuer"),
  isCorporateBond: vi.fn().mockReturnValue(true),
}));

let db: MockDb;

beforeEach(() => {
  db = createMockDb();
  vi.clearAllMocks();
  db.collection("characters");
  db.collection("corporations");
  db.collection("bonds");
  db.collection("portfolioHistory");
  db.collection("exchangeRates");
});

async function setup() {
  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as any);
}

describe("GET /api/character/[id]/portfolio", () => {
  it("normalizes current cash across currencies and derives latest net history from loc debt", async () => {
    await setup();

    const charId = new ObjectId();
    const { requireAuth } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuth).mockResolvedValue({
      ok: true,
      user: { userId: new ObjectId().toString() },
    } as never);

    const { getGameState } = await import("@/lib/gameState");
    vi.mocked(getGameState).mockResolvedValue({ currentTurn: 566 } as any);

    db.collectionMocks.characters.findOne.mockResolvedValue({
      _id: charId,
      sequentialId: 77,
      name: "Test Character",
      countryId: "US",
      currencyBalances: {
        personal: { USD: 100, JPY: 21200 },
        savings: { EUR: 90 },
      },
      lineOfCredit: {
        balances: { USD: 25 },
        arrears: { USD: 5 },
      },
    });

    db.collectionMocks.exchangeRates.find.mockReturnValue({
      toArray: async () => [
        { currencyCode: "USD", rate: 1 },
        { currencyCode: "JPY", rate: 106 },
        { currencyCode: "EUR", rate: 0.9 },
      ],
    });

    db.collectionMocks.corporations.find.mockReturnValue({
      project: () => ({ toArray: async () => [] }),
    });
    db.collectionMocks.bonds.find.mockReturnValue({ toArray: async () => [] });
    db.collectionMocks.portfolioHistory.find.mockReturnValue({
      sort: () => ({
        limit: () => ({
          project: () => ({
            toArray: async () => [
              {
                turn: 566,
                totalValue: 500,
                stockValue: 300,
                bondValue: 40,
                cashValue: 160,
              },
            ],
          }),
        }),
      }),
    });

    const { GET } = await import("./route");
    const res = await GET(new Request("http://localhost/api/character/77/portfolio"), {
      params: Promise.resolve({ id: "77" }),
    });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.cashOnHand).toBe(400); // 100 USD + 21200/106 JPY + 90/0.9 EUR
    expect(data.locDebtValue).toBe(30);
    expect(data.history[0].netValue).toBe(470);
    expect(data.history[0].locDebtValue).toBe(30);
  });

  it("returns the most recent 500 history points (not the oldest) for long-lived characters", async () => {
    await setup();

    const charId = new ObjectId();
    const { requireAuth } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuth).mockResolvedValue({
      ok: true,
      user: { userId: new ObjectId().toString() },
    } as never);

    const { getGameState } = await import("@/lib/gameState");
    vi.mocked(getGameState).mockResolvedValue({ currentTurn: 600 } as any);

    db.collectionMocks.characters.findOne.mockResolvedValue({
      _id: charId,
      sequentialId: 77,
      name: "Test Character",
      countryId: "US",
      currencyBalances: { personal: { USD: 100 }, savings: {} },
    });

    db.collectionMocks.exchangeRates.find.mockReturnValue({
      toArray: async () => [{ currencyCode: "USD", rate: 1 }],
    });
    db.collectionMocks.corporations.find.mockReturnValue({
      project: () => ({ toArray: async () => [] }),
    });
    db.collectionMocks.bonds.find.mockReturnValue({ toArray: async () => [] });

    // 600 turns of history; the chart must show the latest 500 (turns 101-600),
    // not the earliest 500 (turns 1-500). The mock honors sort direction so the
    // assertion fails if the route requests ascending sort + limit(500).
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
          limit: (n: number) => ({
            project: () => ({
              toArray: async () => sorted.slice(0, n),
            }),
          }),
        };
      },
    });

    const { GET } = await import("./route");
    const res = await GET(new Request("http://localhost/api/character/77/portfolio"), {
      params: Promise.resolve({ id: "77" }),
    });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.history).toHaveLength(500);
    // Chart consumer expects ascending turns; oldest of the latest 500 first,
    // most recent last.
    expect(data.history[0].turn).toBe(101);
    expect(data.history[data.history.length - 1].turn).toBe(600);
  });

  it("does not backfill old missing breakdown rows with current values", async () => {
    await setup();

    const charId = new ObjectId();
    const { requireAuth } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuth).mockResolvedValue({
      ok: true,
      user: { userId: new ObjectId().toString() },
    } as never);

    const { getGameState } = await import("@/lib/gameState");
    vi.mocked(getGameState).mockResolvedValue({ currentTurn: 566 } as any);

    db.collectionMocks.characters.findOne.mockResolvedValue({
      _id: charId,
      sequentialId: 77,
      name: "Test Character",
      countryId: "US",
      currencyBalances: {
        personal: { USD: 100 },
        savings: {},
      },
    });

    db.collectionMocks.exchangeRates.find.mockReturnValue({
      toArray: async () => [{ currencyCode: "USD", rate: 1 }],
    });
    db.collectionMocks.corporations.find.mockReturnValue({
      project: () => ({ toArray: async () => [] }),
    });
    db.collectionMocks.bonds.find.mockReturnValue({ toArray: async () => [] });
    db.collectionMocks.portfolioHistory.find.mockReturnValue({
      sort: () => ({
        limit: () => ({
          project: () => ({
            toArray: async () => [
              {
                turn: 500,
                totalValue: 80,
              },
            ],
          }),
        }),
      }),
    });

    const { GET } = await import("./route");
    const res = await GET(new Request("http://localhost/api/character/77/portfolio"), {
      params: Promise.resolve({ id: "77" }),
    });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.history[0].stockValue).toBeUndefined();
    expect(data.history[0].bondValue).toBeUndefined();
    expect(data.history[0].cashValue).toBeUndefined();
  });
});
