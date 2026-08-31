import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

const corpId = new ObjectId();
const ceoId = new ObjectId();

const holderCharId = new ObjectId();

const mockCorp = {
  _id: corpId,
  name: "Acme Corp",
  sequentialId: 1,
  type: "media",
  typeLabel: "Media",
  brandColor: "#f00",
  logoUrl: null,
  headquartersState: "CA",
  countryId: "US",
  liquidCapital: 50000,
  sharePrice: 100,
  totalShares: 1000,
  publicFloat: 600,
  marketingBudget: 5000,
  dividendRate: 0.02,
  ceoId,
  ceoVacant: false,
  shareholders: [{ characterId: holderCharId, shares: 400 }],
  creditRatingSnapshot: "A",
  creditCompositeSnapshot: 75,
  creditSnapshotTurn: 1200,
};

/** find() returns an awaitable cursor whose toArray yields `rows`. */
function cursor(rows: unknown[]) {
  return { toArray: vi.fn().mockResolvedValue(rows) } as never;
}

describe("queryCorporation", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    ["corporations", "characters", "bonds", "corporateSectors", "states"].forEach((n) =>
      db.collection(n)
    );
    // Default empty cursors; individual tests override.
    db.collectionMocks.bonds!.find.mockReturnValue(cursor([]));
    db.collectionMocks.corporateSectors!.find.mockReturnValue(cursor([]));
    db.collectionMocks.states!.find.mockReturnValue(cursor([]));
    db.collectionMocks.characters!.find.mockReturnValue(cursor([]));
  });

  it("returns null when corporation not found", async () => {
    db.collectionMocks.corporations!.findOne.mockResolvedValue(null);
    const { queryCorporation } = await import("./corporation");
    const result = await queryCorporation(db as unknown as Db, { name: "Unknown" });
    expect(result).toBeNull();
  });

  it("includes full bond shape with yieldToMaturity (merged from /financials)", async () => {
    db.collectionMocks.corporations!.findOne.mockResolvedValue(mockCorp);
    db.collectionMocks.characters!.findOne.mockResolvedValue({ _id: ceoId, name: "Jane CEO" });
    db.collectionMocks.bonds!.find.mockReturnValue(
      cursor([
        {
          _id: new ObjectId(),
          couponRate: 0.05,
          maturityLabel: "2Y",
          totalIssued: 100000,
          marketPrice: 98,
          turnsRemaining: 48,
          defaulted: false,
          yieldToMaturity: 5.2,
          holders: 3,
        },
      ])
    );

    const { queryCorporation } = await import("./corporation");
    const result = await queryCorporation(db as unknown as Db, { name: "Acme" });

    expect(result).not.toBeNull();
    expect(result!.bonds[0]).toHaveProperty("yieldToMaturity");
    expect(result!.bonds[0]).toHaveProperty("holders");
  });

  it("derives financials, market cap, and sectors from corporateSectors", async () => {
    db.collectionMocks.corporations!.findOne.mockResolvedValue(mockCorp);
    db.collectionMocks.characters!.findOne.mockResolvedValue({ _id: ceoId, name: "Jane CEO" });
    db.collectionMocks.corporateSectors!.find.mockReturnValue(
      cursor([
        { stateId: "CA", sectorType: "media", revenue: 40000, profitMargin: 30, workers: 100 },
      ])
    );
    db.collectionMocks.states!.find.mockReturnValue(cursor([{ _id: "CA", name: "California" }]));

    const { queryCorporation } = await import("./corporation");
    const result = await queryCorporation(db as unknown as Db, { name: "Acme" });

    expect(result!.financials.totalRevenue).toBe(40000);
    expect(result!.financials.operatingIncome).toBe(12000); // 40000 * 30%
    expect(result!.financials.operatingCosts).toBe(28000);
    expect(result!.balanceSheet.marketCapitalization).toBe(100000); // 100 * 1000
    expect(result!.sectors[0].stateName).toBe("California");
    expect(result!.sectors[0].sectorType).toBe("media");
  });

  it("includes creditRating.components (was missing from /corporation)", async () => {
    db.collectionMocks.corporations!.findOne.mockResolvedValue({
      ...mockCorp,
      creditRatingSnapshot: "A",
      creditCompositeSnapshot: 75,
      creditRatingComponents: {
        debtToEquity: 80,
        interestCoverage: 70,
        profitability: 85,
        liquidity: 90,
      },
      effectiveCouponRate: 0.055,
    });
    db.collectionMocks.characters!.findOne.mockResolvedValue({ _id: ceoId, name: "Jane CEO" });
    db.collectionMocks.corporateSectors!.find.mockReturnValue(cursor([]));
    db.collectionMocks.states!.find.mockReturnValue(cursor([]));

    const { queryCorporation } = await import("./corporation");
    const result = await queryCorporation(db as unknown as Db, { name: "Acme" });

    expect(result!.creditRating).toHaveProperty("components");
    expect(result!.creditRating.components).toEqual({
      debtToEquity: 80,
      interestCoverage: 70,
      profitability: 85,
      liquidity: 90,
    });
  });

  it("resolves embedded shareholder names and credit snapshot fields", async () => {
    db.collectionMocks.corporations!.findOne.mockResolvedValue(mockCorp);
    db.collectionMocks.characters!.findOne.mockResolvedValue({ _id: ceoId, name: "Jane CEO" });
    db.collectionMocks.characters!.find.mockReturnValue(
      cursor([{ _id: holderCharId, name: "Big Holder" }])
    );

    const { queryCorporation } = await import("./corporation");
    const result = await queryCorporation(db as unknown as Db, { name: "Acme" });

    expect(result!.shareStructure.shareholders[0]).toEqual({
      name: "Big Holder",
      shares: 400,
      percentage: 40,
    });
    expect(result!.creditRating.rating).toBe("A");
    expect(result!.creditRating.compositeScore).toBe(75);
  });
});

describe("queryCorporationList", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("corporations");
  });

  it("returns all corporation stubs", async () => {
    db.collectionMocks.corporations!.find.mockReturnValue({
      project: vi.fn().mockReturnThis(),
      sort: vi.fn().mockReturnThis(),
      toArray: vi
        .fn()
        .mockResolvedValue([
          { _id: corpId, name: "Acme Corp", sequentialId: 1, type: "media", countryId: "US" },
        ]),
    } as never);

    const { queryCorporationList } = await import("./corporation");
    const result = await queryCorporationList(db as unknown as Db);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Acme Corp");
  });
});

describe("queryShareHistory", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    ["corporations", "shareTradeHistory"].forEach((n) => db.collection(n));
  });

  it("returns null when corporation not found", async () => {
    db.collectionMocks.corporations!.findOne.mockResolvedValue(null);
    const { queryShareHistory } = await import("./corporation");
    const result = await queryShareHistory(db as unknown as Db, { name: "nope" });
    expect(result).toBeNull();
  });

  it("paginates the trade tape newest first", async () => {
    const corpId = new ObjectId();
    db.collectionMocks.corporations!.findOne.mockResolvedValue({
      _id: corpId,
      sequentialId: 7,
      name: "TestCorp",
    });
    const tapeCol = db.collectionMocks.shareTradeHistory!;
    tapeCol.countDocuments.mockResolvedValue(2);
    tapeCol.find.mockReturnValue({
      sort: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([
        {
          _id: new ObjectId(),
          kind: "trade",
          turn: 10,
          createdAt: new Date("2026-01-01T00:00:00Z"),
          shares: 5,
          pricePerShareAnchor: 2,
          totalAnchor: 10,
          from: null,
          to: { name: "Buyer" },
        },
        {
          _id: new ObjectId(),
          kind: "public_issuance",
          turn: 9,
          createdAt: new Date("2026-01-02T00:00:00Z"),
          shares: 100,
          pricePerShareAnchor: 1,
          totalAnchor: 100,
          from: null,
          to: null,
        },
      ]),
    } as never);

    const { queryShareHistory } = await import("./corporation");
    const result = await queryShareHistory(db as unknown as Db, { id: "7" });
    if (!result || !("entries" in result)) throw new Error("expected result");
    expect(result.corporation).toEqual({ id: 7, name: "TestCorp" });
    expect(result.total).toBe(2);
    expect(result.entries[0].to).toEqual({ name: "Buyer" });
    expect(result.entries[0].createdAt).toBe("2026-01-01T00:00:00.000Z");
  });
});
