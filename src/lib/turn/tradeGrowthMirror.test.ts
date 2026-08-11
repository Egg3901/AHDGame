import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { FOREX_ACTIVE_COUNTRIES } from "@/lib/constants/currencies";
import type { Db } from "mongodb";
import { mirrorTradeGrowth } from "./tradeGrowthMirror";

const N_FOREX = FOREX_ACTIVE_COUNTRIES.length;

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

let db: MockDb;
beforeEach(() => {
  db = createMockDb();
  // Pre-initialize collections so tests can configure mocks
  db.collection("federalBudget");
  db.collection("centralBanks");
});

describe("mirrorTradeGrowth", () => {
  it("copies tradeGrowth from budget to central bank for US", async () => {
    const budgetMock = db.collectionMocks.federalBudget;
    budgetMock.find.mockImplementation((filter: { _id: { $in: string[] } }) => {
      const ids = filter._id.$in;
      const docs: Array<{ _id: string; economicFactors: { tradeGrowth: number } }> = [];
      if (ids.includes("federal")) {
        docs.push({ _id: "federal", economicFactors: { tradeGrowth: 3.5 } });
      }
      return { toArray: vi.fn().mockResolvedValue(docs) };
    });

    const result = await mirrorTradeGrowth(db as unknown as Db);

    const bankMock = db.collectionMocks.centralBanks;
    expect(bankMock.bulkWrite).toHaveBeenCalledTimes(1);
    const [ops] = bankMock.bulkWrite.mock.calls[0] as [
      Array<{ updateOne: { filter: { _id: string }; update: { $set: { tradeGrowth: number } } } }>,
    ];

    const usOp = ops.find((op) => op.updateOne.filter._id === "US");
    expect(usOp).toBeDefined();
    expect(usOp!.updateOne.update.$set.tradeGrowth).toBe(3.5);
    expect(result.countriesUpdated).toBe(N_FOREX);
  });

  it("defaults to 0 when budget is not found", async () => {
    // Default find returns empty array -- no budgets found
    const result = await mirrorTradeGrowth(db as unknown as Db);

    const bankMock = db.collectionMocks.centralBanks;
    expect(bankMock.bulkWrite).toHaveBeenCalledTimes(1);
    const [ops] = bankMock.bulkWrite.mock.calls[0] as [
      Array<{ updateOne: { update: { $set: { tradeGrowth: number } } } }>,
    ];

    // All forex-active countries should get tradeGrowth: 0
    expect(ops.length).toBe(N_FOREX);
    for (const op of ops) {
      expect(op.updateOne.update.$set.tradeGrowth).toBe(0);
    }
    expect(result.countriesUpdated).toBe(N_FOREX);
  });

  it("uses correct budget ID per government type", async () => {
    const budgetMock = db.collectionMocks.federalBudget;
    const capturedIds: string[][] = [];
    budgetMock.find.mockImplementation((filter: { _id: { $in: string[] } }) => {
      capturedIds.push(filter._id.$in);
      return { toArray: vi.fn().mockResolvedValue([]) };
    });

    await mirrorTradeGrowth(db as unknown as Db);

    expect(capturedIds.length).toBe(1);
    const ids = capturedIds[0];
    expect(ids).toContain("federal"); // US (and any other presidential countries)
    expect(ids).toContain("UK");
    expect(ids).toContain("JP");
    expect(ids).toContain("DE");
    expect(ids).toContain("CN");
    // BR is presidential, so it shares "federal" with US
  });
});
