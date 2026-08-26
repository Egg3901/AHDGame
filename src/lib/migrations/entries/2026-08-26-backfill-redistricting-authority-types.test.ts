import type { Db } from "mongodb";
import { describe, expect, it, vi } from "vitest";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { migration } from "./2026-08-26-backfill-redistricting-authority-types";
import { POLITICAL_LEGISLATION_RETAINED_OLD_IDS } from "@/lib/politicalMetrics/pipelinePreset";

const RETAINED = [...POLITICAL_LEGISLATION_RETAINED_OLD_IDS];

function setup(existingIds: string[]) {
  const db = createMockDb() as unknown as MockDb;
  db.collection("legislationTypes").find.mockReturnValue({
    project: vi.fn().mockReturnThis(),
    toArray: vi.fn().mockResolvedValue(existingIds.map((_id) => ({ _id }))),
  });
  return db;
}

describe("2026-08-26-backfill-redistricting-authority-types", () => {
  it("inserts the retained redistricting types a live world never received", async () => {
    const db = setup([]);

    const result = await migration.execute(db as unknown as Db, { dryRun: false });

    const ops = db.collectionMocks.legislationTypes.bulkWrite.mock.calls[0][0] as Array<{
      updateOne: { filter: { _id: string }; update: { $setOnInsert: unknown }; upsert: boolean };
    }>;
    expect(ops.map((op) => op.updateOne.filter._id).sort()).toEqual([...RETAINED].sort());
    expect(result.documentsInserted).toBe(RETAINED.length);
    // $setOnInsert, never $set: an existing doc keeps any admin edit or drift.
    for (const op of ops) {
      expect(op.updateOne.upsert).toBe(true);
      expect(op.updateOne.update.$setOnInsert).toBeTruthy();
      // _id belongs to the filter, never to the update operator.
      expect(op.updateOne.update.$setOnInsert).not.toHaveProperty("_id");
    }
  });

  it("writes the real seeded documents, options and all", async () => {
    const db = setup([]);

    await migration.execute(db as unknown as Db, { dryRun: false });

    const ops = db.collectionMocks.legislationTypes.bulkWrite.mock.calls[0][0] as Array<{
      updateOne: {
        filter: { _id: string };
        update: { $setOnInsert: { policyOptions?: unknown[] } };
      };
    }>;
    const authority = ops.find(
      (op) => op.updateOne.filter._id === "us_state_redistricting_authority"
    )!;
    expect(authority.updateOne.update.$setOnInsert.policyOptions).toHaveLength(3);
  });

  it("is a no-op when the types are already present", async () => {
    const db = setup(RETAINED);

    const result = await migration.execute(db as unknown as Db, { dryRun: false });

    expect(db.collectionMocks.legislationTypes.bulkWrite).not.toHaveBeenCalled();
    expect(result.documentsInserted).toBe(0);
  });

  it("writes nothing on a dry run", async () => {
    const db = setup([]);

    const result = await migration.execute(db as unknown as Db, { dryRun: true });

    expect(db.collectionMocks.legislationTypes.bulkWrite).not.toHaveBeenCalled();
    expect(result.documentsInserted).toBe(0);
    expect(result.notes?.join(" ")).toMatch(/dry run/i);
  });

  it("is declared idempotent", () => {
    expect(migration.idempotent).toBe(true);
  });
});
