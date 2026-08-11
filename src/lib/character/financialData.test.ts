import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/corporation/dividendIncomeFromHistory", () => ({
  estimateCorpDividendPaidLastTurn: vi.fn().mockReturnValue(0),
  fetchLatestCorpHistoryDividendRows: vi.fn().mockResolvedValue(new Map()),
}));
vi.mock("@/lib/corporations/marketQuote", () => ({
  getPublicShareQuote: vi.fn().mockReturnValue(0),
}));

function makeCursor(docs: unknown[]) {
  return {
    toArray: vi.fn().mockResolvedValue(docs),
    sort: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    skip: vi.fn().mockReturnThis(),
    project: vi.fn().mockReturnThis(),
  };
}

describe("getFinancialData", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("corporations");
    db.collection("bonds");
    db.collection("exchangeRates");
    db.collection("corporateSectors");

    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
  });

  it("anchor-normalizes foreign bond coupon income using the projected bond currency", async () => {
    const charId = new ObjectId();

    db.collectionMocks["corporations"]!.findOne.mockResolvedValue(null);
    db.collectionMocks["corporations"]!.find.mockReturnValue(makeCursor([]));
    db.collectionMocks["bonds"]!.find.mockReturnValue(
      makeCursor([
        {
          _id: new ObjectId(),
          couponRate: 48,
          currencyCode: "JPY",
          holders: [{ characterId: charId, units: 100 }],
        },
      ])
    );
    db.collectionMocks["exchangeRates"]!.find.mockReturnValue(
      makeCursor([{ currencyCode: "JPY", rate: 100 }])
    );

    const { getFinancialData } = await import("./financialData");
    const result = await getFinancialData(charId);

    // 48% annual on ¥1,000 face = ¥10 per turn per unit. 100 units = ¥1,000/turn.
    // At 100 JPY per anchor unit, the strip should show 10 anchor, not 1000.
    expect(result.bondIncomePerTurn).toBe(10);
  });

  it("only treats non-vacant CEO corporations as active financial data", async () => {
    const charId = new ObjectId();

    db.collectionMocks["corporations"]!.findOne.mockResolvedValue(null);
    db.collectionMocks["corporations"]!.find.mockReturnValue(makeCursor([]));
    db.collectionMocks["bonds"]!.find.mockReturnValue(makeCursor([]));
    db.collectionMocks["exchangeRates"]!.find.mockReturnValue(makeCursor([]));

    const { getFinancialData } = await import("./financialData");
    const result = await getFinancialData(charId);

    expect(db.collectionMocks["corporations"]!.findOne).toHaveBeenCalledWith({
      ceoId: charId,
      ceoVacant: { $ne: true },
    });
    expect(result.corporation).toBeNull();
    expect(db.collectionMocks["corporateSectors"]!.aggregate).not.toHaveBeenCalled();
  });
});
