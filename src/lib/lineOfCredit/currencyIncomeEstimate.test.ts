import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/currency/characterFunds", () => ({
  getHomeCurrency: vi.fn().mockReturnValue("USD"),
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

function installFinancialTxFindMock(db: MockDb, docs: Array<Record<string, unknown>>) {
  db.collectionMocks["financialTxLog"]!.find.mockImplementation(
    (query?: Record<string, unknown>) => {
      const turnFilter = (query?.turn as { $gte?: number; $lte?: number } | undefined) ?? {};
      const typeFilter = (query?.type as { $in?: unknown[] } | undefined)?.$in ?? [];
      const filtered = docs.filter((doc) => {
        const turn = typeof doc.turn === "number" ? doc.turn : 0;
        const type = doc.type;
        return (
          (turnFilter.$gte === undefined || turn >= turnFilter.$gte) &&
          (turnFilter.$lte === undefined || turn <= turnFilter.$lte) &&
          (typeFilter.length === 0 || typeFilter.includes(type))
        );
      });

      return makeCursor(filtered);
    }
  );
}

describe("estimatePerTurnCurrencyIncomeHomeFace", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("financialTxLog");
    db.collection("gameState");
    db.collectionMocks["gameState"]!.findOne.mockResolvedValue({
      _id: "current",
      currentTurn: 100,
    });
  });

  it("averages recurring income across the last 48 turns and ignores older spikes", async () => {
    const characterId = new ObjectId();

    installFinancialTxFindMock(db, [
      {
        type: "corp_salary",
        turn: 100,
        amount: 150,
        currencyCode: "USD",
        anchorAmount: 150,
      },
      {
        type: "bond_coupon",
        turn: 76,
        amount: 4_800,
        currencyCode: "JPY",
        anchorAmount: 48,
      },
      {
        type: "corp_dividend",
        turn: 51,
        amount: 9_999,
        currencyCode: "USD",
        anchorAmount: 9_999,
      },
    ]);

    const { estimatePerTurnCurrencyIncomeHomeFace } = await import("./currencyIncomeEstimate");
    const result = await estimatePerTurnCurrencyIncomeHomeFace(
      db as unknown as Db,
      { _id: characterId } as never,
      { USD: 1, JPY: 100 }
    );

    expect(result).toBeCloseTo(198 / 48);
  });

  it("falls back to live FX conversion when older tx rows are missing anchor snapshots", async () => {
    const characterId = new ObjectId();

    db.collectionMocks["gameState"]!.findOne.mockResolvedValue({
      _id: "current",
      currentTurn: 12,
    });
    installFinancialTxFindMock(db, [
      {
        type: "bond_coupon",
        turn: 12,
        amount: 1_200,
        currencyCode: "JPY",
      },
    ]);

    const { estimatePerTurnCurrencyIncomeHomeFace } = await import("./currencyIncomeEstimate");
    const result = await estimatePerTurnCurrencyIncomeHomeFace(
      db as unknown as Db,
      { _id: characterId } as never,
      { USD: 1, JPY: 100 }
    );

    expect(result).toBe(1);
  });
});
