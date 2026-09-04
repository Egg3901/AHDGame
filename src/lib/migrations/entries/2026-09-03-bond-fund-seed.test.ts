import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { BOND_FUND_DEFINITIONS } from "@/lib/indexFunds/fundDefinitions";
import { migration } from "./2026-09-03-bond-fund-seed";

let db: MockDb;

beforeEach(() => {
  db = createMockDb();
  db.collection("indexFunds");
  db.collection("indexFundPositions");
});

describe("bond fund seed migration", () => {
  it("inserts every missing bond fund with a reserve position", async () => {
    db.collectionMocks.indexFunds.find.mockReturnValue({
      toArray: async () => [{ slug: "global_high_yield" }],
    });
    const result = await migration.execute(db as unknown as Db, { dryRun: false });
    expect(result.documentsInserted).toBe(BOND_FUND_DEFINITIONS.length - 1);
    expect(db.collectionMocks.indexFunds.insertOne).toHaveBeenCalledTimes(
      BOND_FUND_DEFINITIONS.length - 1
    );
    const first = db.collectionMocks.indexFunds.insertOne.mock.calls[0]![0] as {
      kind: string;
      status: string;
      holdings: unknown[];
    };
    expect(first.kind).toBe("bond");
    expect(first.status).toBe("active");
    expect(first.holdings).toEqual([]);
    expect(db.collectionMocks.indexFundPositions.updateOne).toHaveBeenCalledTimes(
      BOND_FUND_DEFINITIONS.length - 1
    );
  });

  it("writes nothing in dry run", async () => {
    db.collectionMocks.indexFunds.find.mockReturnValue({ toArray: async () => [] });
    const result = await migration.execute(db as unknown as Db, { dryRun: true });
    expect(db.collectionMocks.indexFunds.insertOne).not.toHaveBeenCalled();
    expect(result.notes?.[0]).toContain(`would seed ${BOND_FUND_DEFINITIONS.length}`);
  });
});
