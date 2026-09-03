import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { migration } from "./2026-09-03-bond-market-pools";

let db: MockDb;

function arm(options: { existing?: string[] } = {}) {
  db.collection("exchangeRates").find.mockReturnValue({
    toArray: async () => [{ currencyCode: "USD" }, { currencyCode: "GBP" }],
  });
  db.collection("bonds").aggregate.mockReturnValue({
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
  db.collection("bondMarketPools").find.mockReturnValue({
    toArray: async () => (options.existing ?? []).map((id) => ({ _id: id })),
  });
}

beforeEach(() => {
  db = createMockDb();
});

describe("bond market pools migration", () => {
  it("seeds every traded and bond currency at a share of M2, empty where no snapshot exists", async () => {
    arm();
    const result = await migration.execute(db as unknown as Db, { dryRun: false });
    const docs = db.collectionMocks.bondMarketPools.insertMany.mock.calls[0]![0] as Array<{
      _id: string;
      cashLocal: number;
      targetCashLocal: number;
    }>;
    expect(docs.map((d) => d._id)).toEqual(["FRF", "GBP", "USD"]);
    expect(docs.find((d) => d._id === "USD")).toMatchObject({
      cashLocal: 50_000,
      targetCashLocal: 50_000,
    });
    expect(docs.find((d) => d._id === "FRF")).toMatchObject({ cashLocal: 0, targetCashLocal: 0 });
    expect(result.documentsInserted).toBe(3);
  });

  it("skips pools that already exist", async () => {
    arm({ existing: ["USD"] });
    const result = await migration.execute(db as unknown as Db, { dryRun: false });
    const docs = db.collectionMocks.bondMarketPools.insertMany.mock.calls[0]![0] as Array<{
      _id: string;
    }>;
    expect(docs.map((d) => d._id)).toEqual(["FRF", "GBP"]);
    expect(result.documentsInserted).toBe(2);
  });

  it("writes nothing in dry run", async () => {
    arm();
    const result = await migration.execute(db as unknown as Db, { dryRun: true });
    expect(db.collectionMocks.bondMarketPools.insertMany).not.toHaveBeenCalled();
    expect(result.documentsInserted).toBe(0);
    expect(result.notes?.[0]).toContain("would seed 3");
  });
});
