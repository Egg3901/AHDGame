import { describe, it, expect, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, bulkOps, type MockDb } from "@/lib/test-utils/mockDb";
import { migration } from "./2026-08-26-redistricting-authority-legislative";
import { REDISTRICT_AUTHORITY_LAW } from "@/lib/redistricting/caps";

function buildDb(districtStates: string[], existingAuthorityStates: string[]): MockDb {
  const db = createMockDb();
  db.collection("congressionalDistricts");
  db.collection("statePolicies");
  db.collectionMocks.congressionalDistricts!.distinct = vi.fn().mockResolvedValue(districtStates);
  db.collectionMocks.statePolicies!.find = vi.fn().mockReturnValue({
    project: () => ({
      toArray: async () => existingAuthorityStates.map((stateId) => ({ stateId })),
    }),
  });
  return db;
}

describe("2026-08-26-redistricting-authority-legislative", () => {
  it("dry run reads but never writes", async () => {
    const db = buildDb(["OH", "CA"], []);
    const res = await migration.execute(db as unknown as Db, { dryRun: true });
    expect(db.collectionMocks.statePolicies?.bulkWrite).not.toHaveBeenCalled();
    expect(res.notes?.some((n) => n.includes("dry run"))).toBe(true);
  });

  it("backfills only states missing an authority row, legislature-drawn", async () => {
    const db = buildDb(["OH", "CA", "TX"], ["CA"]); // CA already set
    await migration.execute(db as unknown as Db, { dryRun: false });
    const ops = bulkOps(db.collectionMocks.statePolicies!.bulkWrite);
    expect(ops.map(([f]) => f.stateId).sort()).toEqual(["OH", "TX"]);
    for (const [filter, update] of ops) {
      expect(filter.legislationTypeId).toBe(REDISTRICT_AUTHORITY_LAW);
      const seed = (update.$setOnInsert ?? {}) as Record<string, unknown>;
      expect(seed.policyOptionIndex).toBe(2);
      expect(update.$set).toBeUndefined(); // never clobbers
    }
  });

  it("no districted states → no writes", async () => {
    const db = buildDb([], []);
    const res = await migration.execute(db as unknown as Db, { dryRun: false });
    expect(db.collectionMocks.statePolicies?.bulkWrite).not.toHaveBeenCalled();
    expect(res.documentsScanned).toBe(0);
  });
});
