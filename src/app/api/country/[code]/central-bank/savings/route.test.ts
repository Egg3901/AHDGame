import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({
  requireBasicAuth: vi.fn(),
}));
vi.mock("@/lib/db/characterLookup", () => ({
  getCharacterByUserId: vi.fn(),
}));
vi.mock("@/lib/gameState", () => ({
  getGameState: vi.fn(),
}));
vi.mock("@/lib/currency/featureFlag", () => ({
  isForexEnabled: vi.fn().mockResolvedValue(true),
}));
vi.mock("@/lib/savings/nationalTotals", () => ({
  sumSavingsInCurrency: vi.fn().mockResolvedValue(0),
}));
vi.mock("@/lib/savings/ledger", () => ({
  fetchSavingsLedgerForCharacter: vi.fn().mockResolvedValue([]),
}));

let db: MockDb;

beforeEach(async () => {
  db = createMockDb();
  vi.clearAllMocks();
  db.collection("centralBanks");
  db.collection("portfolioHistory");
  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as any);
});

describe("GET /api/country/[code]/central-bank/savings", () => {
  it("returns the most recent 500 savings history points (not the oldest) for long-lived characters", async () => {
    const userId = new ObjectId().toString();
    const charId = new ObjectId();

    const { requireBasicAuth } = await import("@/lib/api/requireAuth");
    vi.mocked(requireBasicAuth).mockResolvedValue({
      ok: true,
      user: { userId },
    } as never);

    const { getCharacterByUserId } = await import("@/lib/db/characterLookup");
    vi.mocked(getCharacterByUserId).mockResolvedValue({
      _id: charId,
      countryId: "US",
      currencyBalances: { personal: { USD: 1000 }, savings: { USD: 500 } },
      savingsAccountsOpened: { USD: true },
    } as any);

    const { getGameState } = await import("@/lib/gameState");
    vi.mocked(getGameState).mockResolvedValue({ currentTurn: 600 } as any);

    db.collectionMocks.centralBanks.findOne.mockResolvedValue({ primeRate: 3.0 });

    // 600 turns of history; chart query (sort: -1, limit 500) should return
    // turns 101-600 reversed back to ascending.
    const allRecords = Array.from({ length: 600 }, (_, i) => ({
      turn: i + 1,
      savingsCashValue: 500 + i,
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
    const res = await GET(new Request("http://localhost/api/country/us/central-bank/savings"), {
      params: Promise.resolve({ code: "us" }),
    });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.savingsHistory).toHaveLength(500);
    expect(data.savingsHistory[0].turn).toBe(101);
    expect(data.savingsHistory[data.savingsHistory.length - 1].turn).toBe(600);
  });
});
