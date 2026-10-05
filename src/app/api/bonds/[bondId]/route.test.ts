import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getAuthUser: vi.fn().mockResolvedValue(null) }));
vi.mock("@/lib/gameState", () => ({
  getGameState: vi.fn().mockResolvedValue({ currentTurn: 12 }),
}));
vi.mock("@/lib/currency/featureFlag", () => ({
  isForexEnabled: vi.fn().mockResolvedValue(false),
}));
vi.mock("@/lib/bonds/marketPool", () => ({
  loadBondQuote: vi.fn().mockResolvedValue({
    bidPerUnit: 980,
    askPerUnit: 1_020,
    depthUnitsAtBid: 50,
  }),
}));

function cursor<T>(rows: T[]) {
  const value = {
    project: () => value,
    sort: () => value,
    toArray: async () => rows,
  };
  return value;
}

describe("GET /api/bonds/[bondId] institutional ownership", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    for (const collection of ["bonds", "indexFunds", "npps", "bondHistory"]) {
      db.collection(collection);
    }
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
  });

  it("returns fund, NPP, and central-bank holders and includes all three in held units", async () => {
    const bondId = new ObjectId();
    const issuerId = new ObjectId();
    const fundId = new ObjectId();
    const nppId = new ObjectId();
    db.collectionMocks.bonds.findOne.mockResolvedValue({
      _id: bondId,
      issuerType: "sovereign",
      corporationId: issuerId,
      countryId: "US",
      currencyCode: "USD",
      issuerName: "United States",
      faceValue: 1_000,
      couponRate: 5,
      maturityTurns: 48,
      issuedAtTurn: -36,
      maturityTurn: 12,
      marketPrice: 1,
      totalIssued: 100_000,
      publicFloat: 65,
      holders: [
        { fundId, units: 20 },
        { nppId, units: 10 },
      ],
      centralBankHoldings: 5,
      defaulted: false,
      defaultedAtTurn: null,
      matured: false,
    });
    db.collectionMocks.indexFunds.find.mockReturnValue(
      cursor([
        {
          _id: fundId,
          name: "United States Bond Fund",
          slug: "us-bond-fund",
          scope: "country",
          countryId: "US",
        },
      ])
    );
    db.collectionMocks.npps.find.mockReturnValue(
      cursor([
        {
          _id: nppId,
          name: "Institutional Investor",
          sequentialId: 44,
          avatarUrl: "/npp.png",
        },
      ])
    );
    db.collectionMocks.bondHistory.find.mockReturnValue(cursor([]));

    const { GET } = await import("./route");
    const response = await GET(new Request(`http://localhost/api/bonds/${bondId}`), {
      params: Promise.resolve({ bondId: bondId.toString() }),
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      bond: { heldUnits: number };
      holders: Array<{ type: string; name: string; units: number }>;
    };
    expect(body.bond.heldUnits).toBe(35);
    expect(body.holders).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "fund", name: "United States Bond Fund", units: 20 }),
        expect.objectContaining({ type: "npp", name: "Institutional Investor", units: 10 }),
        expect.objectContaining({ type: "central_bank", units: 5 }),
      ])
    );
  });
});
