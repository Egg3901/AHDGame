import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { migration } from "./2026-09-03-equity-market-pools";

let db: MockDb;

function arm(existing: string[] = []) {
  db.collection("exchangeRates").find.mockReturnValue({
    toArray: async () => [{ currencyCode: "USD" }, { currencyCode: "GBP" }],
  });
  db.collection("corporations").aggregate.mockReturnValue({
    toArray: async () => [{ _id: "USD" }, { _id: "FRF" }, { _id: null }],
  });
  db.collection("moneySupplySnapshots").find.mockImplementation((filter: { turn?: number }) => ({
    toArray: async () =>
      filter?.turn == null
        ? [{ turn: 583 }]
        : [
            { currencyCode: "USD", m2: 1_000_000 },
            { currencyCode: "GBP", m2: 200_000 },
          ],
  }));
  db.collection("equityMarketPools").find.mockReturnValue({
    toArray: async () => existing.map((id) => ({ _id: id })),
  });
}

beforeEach(() => {
  db = createMockDb();
});

describe("equity market pools migration", () => {
  it("seeds every traded and corporation currency from M2", async () => {
    arm();
    const result = await migration.execute(db as unknown as Db, { dryRun: false });
    const docs = db.collectionMocks.equityMarketPools.insertMany.mock.calls[0]![0] as Array<{
      _id: string;
      cashLocal: number;
      targetCashLocal: number;
    }>;
    expect(docs.map((doc) => doc._id)).toEqual(["FRF", "GBP", "USD"]);
    expect(docs.find((doc) => doc._id === "USD")).toMatchObject({
      cashLocal: 50_000,
      targetCashLocal: 50_000,
    });
    expect(docs.find((doc) => doc._id === "FRF")).toMatchObject({
      cashLocal: 0,
      targetCashLocal: 0,
    });
    expect(result.documentsInserted).toBe(3);
  });

  it("is insert-only and dry-run safe", async () => {
    arm(["USD"]);
    const result = await migration.execute(db as unknown as Db, { dryRun: true });
    expect(db.collectionMocks.equityMarketPools.insertMany).not.toHaveBeenCalled();
    expect(result.documentsInserted).toBe(0);
    expect(result.notes?.[0]).toContain("would seed 2");
  });
});
