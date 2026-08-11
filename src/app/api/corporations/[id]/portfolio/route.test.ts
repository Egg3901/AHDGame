import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/gameState", () => ({
  getGameState: vi.fn().mockResolvedValue({ currentTurn: 100 }),
}));
vi.mock("@/lib/api/corporations/resolveQuery", () => ({
  resolveCorporation: vi.fn(),
}));
vi.mock("@/lib/corporations/imfPortfolioReceivables", () => ({
  findImfFacilityReceivablesForLender: vi.fn().mockResolvedValue({
    receivables: [],
    totalPrincipal: 0,
  }),
}));

let db: MockDb;

beforeEach(async () => {
  db = createMockDb();
  vi.clearAllMocks();
  // Re-apply getGameState after clearAllMocks resets it
  const { getGameState } = await import("@/lib/gameState");
  vi.mocked(getGameState).mockResolvedValue({ currentTurn: 100 } as any);
  // Pre-initialize collections so collectionMocks entries exist
  db.collection("corporations");
  db.collection("bonds");
  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as any);
});

describe("GET /api/corporations/[id]/portfolio", () => {
  it("returns empty portfolio when corp holds nothing", async () => {
    const corpId = new ObjectId();
    const { resolveCorporation } = await import("@/lib/api/corporations/resolveQuery");
    vi.mocked(resolveCorporation).mockResolvedValue({
      ok: true,
      corporation: {
        _id: corpId,
        name: "Test Corp",
        shareholders: [],
        ceoId: new ObjectId(),
      } as any,
    } as any);

    db.collectionMocks["corporations"].find.mockReturnValue({
      project: () => ({ toArray: async () => [] }),
    });
    db.collectionMocks["bonds"].find.mockReturnValue({
      toArray: async () => [],
    });

    const { GET } = await import("./route");
    const req = new Request("http://localhost/api/corporations/abc/portfolio");
    const res = await GET(req, { params: Promise.resolve({ id: "abc" }) });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.corporationName).toBe("Test Corp");
    expect(json.isNationalCorp).toBe(false);
    expect(json.stockHoldings).toEqual([]);
    expect(json.bondHoldings).toEqual([]);
    expect(json.cashOnHand).toBe(0);
    expect(json.totalLiabilityValue).toBe(0);
    expect(json.grossPortfolioValue).toBe(0);
    expect(json.totalPortfolioValue).toBe(0);
  });

  it("includes anchor-normalized liquidCapital in cashOnHand and net worth", async () => {
    const corpId = new ObjectId();
    const { resolveCorporation } = await import("@/lib/api/corporations/resolveQuery");
    vi.mocked(resolveCorporation).mockResolvedValue({
      ok: true,
      corporation: {
        _id: corpId,
        name: "Cash-Only Corp",
        shareholders: [],
        ceoId: new ObjectId(),
        liquidCapital: 1_000_000,
      } as any,
    } as any);

    db.collectionMocks["corporations"].find.mockReturnValue({
      project: () => ({ toArray: async () => [] }),
    });
    db.collectionMocks["bonds"].find.mockReturnValue({
      toArray: async () => [],
    });

    const { GET } = await import("./route");
    const req = new Request("http://localhost/api/corporations/abc/portfolio");
    const res = await GET(req, { params: Promise.resolve({ id: "abc" }) });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.cashOnHand).toBe(1_000_000);
    expect(json.totalLiabilityValue).toBe(0);
    expect(json.grossPortfolioValue).toBe(1_000_000);
    // Corp has no stocks or bonds — net worth is liquid capital only.
    expect(json.totalPortfolioValue).toBe(1_000_000);
  });

  it("returns bond holdings with coupon income", async () => {
    const corpId = new ObjectId();
    const bondId = new ObjectId();
    const issuerCorpId = new ObjectId();

    const { resolveCorporation } = await import("@/lib/api/corporations/resolveQuery");
    vi.mocked(resolveCorporation).mockResolvedValue({
      ok: true,
      corporation: {
        _id: corpId,
        name: "Test Corp",
        shareholders: [],
        ceoId: new ObjectId(),
      } as any,
    } as any);

    // Stock holdings query returns empty
    db.collectionMocks["corporations"].find.mockReturnValue({
      project: () => ({ toArray: async () => [] }),
    });

    // Bond holdings query returns one bond held by the corp
    db.collectionMocks["bonds"].find.mockReturnValue({
      toArray: async () => [
        {
          _id: bondId,
          corporationId: issuerCorpId,
          issuerType: "corporation",
          couponRate: 5,
          marketPrice: 1.0,
          maturityTurn: 148,
          maturityTurns: 48,
          holders: [{ corporationId: corpId, units: 10, avgCostPerUnit: 1000 }],
          defaulted: false,
          matured: false,
        },
      ],
    });

    // Issuer corp lookup for display name
    db.collectionMocks["corporations"].findOne = vi.fn().mockResolvedValue({
      _id: issuerCorpId,
      name: "Apex Corp",
      sequentialId: 5,
      brandColor: "#ff0000",
    });

    const { GET } = await import("./route");
    const req = new Request("http://localhost/api/corporations/abc/portfolio");
    const res = await GET(req, { params: Promise.resolve({ id: "abc" }) });
    const json = await res.json();

    expect(json.bondHoldings).toHaveLength(1);
    expect(json.bondHoldings[0].units).toBe(10);
    expect(json.bondHoldings[0].turnsRemaining).toBe(48); // 148 - 100
    expect(json.bondHoldings[0].holderCorpId).toBeDefined();
    expect(json.totalLiabilityValue).toBe(0);
    expect(json.totalCouponIncomePerTurn).toBeGreaterThan(0);
  });

  it("merges IMF facility receivables into bond holdings and total bond value", async () => {
    const corpId = new ObjectId();
    const borrowerId = new ObjectId();

    const { resolveCorporation } = await import("@/lib/api/corporations/resolveQuery");
    vi.mocked(resolveCorporation).mockResolvedValue({
      ok: true,
      corporation: {
        _id: corpId,
        name: "IMF Corp",
        shareholders: [],
        ceoId: new ObjectId(),
      } as any,
    } as any);

    db.collectionMocks["corporations"].find.mockReturnValue({
      project: () => ({ toArray: async () => [] }),
    });
    db.collectionMocks["bonds"].find.mockReturnValue({
      toArray: async () => [],
    });

    const { findImfFacilityReceivablesForLender } =
      await import("@/lib/corporations/imfPortfolioReceivables");
    vi.mocked(findImfFacilityReceivablesForLender).mockResolvedValueOnce({
      receivables: [
        {
          borrowerCorporationId: borrowerId.toString(),
          borrowerName: "Rescued Industries",
          sequentialId: 42,
          principalOutstanding: 250_000,
          annualRatePercent: 6,
          amortizationTurnsRemaining: 200,
          logoUrl: null,
          brandColor: null,
        },
      ],
      totalPrincipal: 250_000,
    });

    const { GET } = await import("./route");
    const res = await GET(new Request("http://localhost/api/x/portfolio"), {
      params: Promise.resolve({ id: corpId.toString() }),
    });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.bondHoldings).toHaveLength(1);
    expect(json.bondHoldings[0].imfFacilityLoan).toBe(true);
    expect(json.bondHoldings[0].totalValue).toBe(250_000);
    expect(json.totalBondValue).toBe(250_000);
    expect(json.totalLiabilityValue).toBe(0);
    expect(json.grossPortfolioValue).toBe(250_000);
    expect(json.totalPortfolioValue).toBe(250_000);
  });

  it("returns the most recent 500 history points (not the oldest) for long-lived corps", async () => {
    const corpId = new ObjectId();
    const { resolveCorporation } = await import("@/lib/api/corporations/resolveQuery");
    vi.mocked(resolveCorporation).mockResolvedValue({
      ok: true,
      corporation: {
        _id: corpId,
        name: "Long-Lived Corp",
        shareholders: [],
        ceoId: new ObjectId(),
      } as any,
    } as any);

    db.collectionMocks["corporations"].find.mockReturnValue({
      project: () => ({ toArray: async () => [] }),
    });
    db.collectionMocks["bonds"].find.mockReturnValue({
      toArray: async () => [],
    });

    // 600 turns of corp history; the chart should show turns 101-600 reversed
    // to ascending, not the earliest 500.
    db.collection("corporationPortfolioHistory");
    const allRecords = Array.from({ length: 600 }, (_, i) => ({
      turn: i + 1,
      totalValue: 5000 + i,
      cashValue: 5000 + i,
    }));
    db.collectionMocks["corporationPortfolioHistory"].find.mockReturnValue({
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
    const res = await GET(new Request("http://localhost/api/x/portfolio"), {
      params: Promise.resolve({ id: corpId.toString() }),
    });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.history).toHaveLength(500);
    expect(json.history[0].turn).toBe(101);
    expect(json.history[json.history.length - 1].turn).toBe(600);
  });

  it("subtracts issued bond debt from debt-adjusted net worth", async () => {
    const corpId = new ObjectId();

    const { resolveCorporation } = await import("@/lib/api/corporations/resolveQuery");
    vi.mocked(resolveCorporation).mockResolvedValue({
      ok: true,
      corporation: {
        _id: corpId,
        name: "Leveraged Corp",
        shareholders: [],
        ceoId: new ObjectId(),
        liquidCapital: 100_000,
      } as any,
    } as any);

    db.collectionMocks["corporations"].find.mockReturnValue({
      project: () => ({ toArray: async () => [] }),
    });
    db.collectionMocks["bonds"].find.mockReturnValue({
      toArray: async () => [
        {
          _id: new ObjectId(),
          corporationId: corpId,
          issuerType: "corporation",
          totalIssued: 400_000,
          couponRate: 5,
          marketPrice: 1,
          maturityTurn: 200,
          maturityTurns: 100,
          holders: [],
          defaulted: false,
          matured: false,
        },
      ],
    });

    const { GET } = await import("./route");
    const res = await GET(new Request("http://localhost/api/x/portfolio"), {
      params: Promise.resolve({ id: corpId.toString() }),
    });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.cashOnHand).toBe(100_000);
    expect(json.grossPortfolioValue).toBe(100_000);
    expect(json.totalLiabilityValue).toBe(400_000);
    expect(json.totalPortfolioValue).toBe(-300_000);
  });
});
