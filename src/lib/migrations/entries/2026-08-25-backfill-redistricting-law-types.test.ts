import { describe, it, expect, beforeEach } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { migration } from "./2026-08-25-backfill-redistricting-law-types";
import { legislationTypes } from "@/lib/seeds/reference/legislationTypes";

const REDISTRICTING_LAW_IDS = [
  "us_state_redistricting_authority",
  "us_state_compactness",
  "us_state_fairness",
];

let db: MockDb;

function wire(existingIds: string[]) {
  db = createMockDb();
  db.collection("legislationTypes");
  db.collectionMocks.legislationTypes.find.mockReturnValue({
    toArray: async () => existingIds.map((id) => ({ _id: id })),
  });
  db.collectionMocks.legislationTypes.bulkWrite.mockResolvedValue({ upsertedCount: 0 });
}

describe("migration: backfill-redistricting-law-types", () => {
  beforeEach(() => wire([]));

  it("inserts the three mechanical redistricting laws when missing (ticket #1189)", async () => {
    // The old-catalog exclusion sweep stripped these from every live world,
    // so the State Redistricting Authority Act had no doc to propose against.
    const res = await migration.execute(db as unknown as Db, { dryRun: false });

    const ops = db.collectionMocks.legislationTypes.bulkWrite.mock.calls[0][0] as {
      updateOne: { filter: { _id: string }; update: { $setOnInsert: Record<string, unknown> } };
    }[];
    expect(ops.map((o) => o.updateOne.filter._id).sort()).toEqual(
      [...REDISTRICTING_LAW_IDS].sort()
    );
    expect(res.documentsInserted).toBe(3);

    // The authority law must carry the three proposable options, including
    // legislature-drawn ("partisan") redistricting.
    const authority = ops.find(
      (o) => o.updateOne.filter._id === "us_state_redistricting_authority"
    )!;
    const optionIds = (
      authority.updateOne.update.$setOnInsert.policyOptions as { id: string }[]
    ).map((o) => o.id);
    expect(optionIds).toHaveLength(3);
  });

  it("sources docs verbatim from the reference catalog", async () => {
    await migration.execute(db as unknown as Db, { dryRun: false });
    const ops = db.collectionMocks.legislationTypes.bulkWrite.mock.calls[0][0] as {
      updateOne: { filter: { _id: string }; update: { $setOnInsert: Record<string, unknown> } };
    }[];
    for (const op of ops) {
      const reference = legislationTypes.find((t) => t._id === op.updateOne.filter._id)!;
      expect(op.updateOne.update.$setOnInsert).toEqual(reference);
      expect(reference.allowedScope).toBe("state");
    }
  });

  it("never overwrites an existing doc: inserts use $setOnInsert only", async () => {
    await migration.execute(db as unknown as Db, { dryRun: false });
    const ops = db.collectionMocks.legislationTypes.bulkWrite.mock.calls[0][0] as unknown[];
    expect(JSON.stringify(ops)).not.toContain('"$set"');
  });

  it("is a no-op when all three laws already exist", async () => {
    wire(REDISTRICTING_LAW_IDS);
    const res = await migration.execute(db as unknown as Db, { dryRun: false });
    expect(db.collectionMocks.legislationTypes.bulkWrite).not.toHaveBeenCalled();
    expect(res.documentsInserted).toBe(0);
  });

  it("writes nothing on a dry run", async () => {
    const res = await migration.execute(db as unknown as Db, { dryRun: true });
    expect(db.collectionMocks.legislationTypes.bulkWrite).not.toHaveBeenCalled();
    expect(res.notes?.join(" ")).toContain("Dry run");
  });

  it("is registered and idempotent", () => {
    expect(migration.id).toBe("2026-08-25-backfill-redistricting-law-types");
    expect(migration.idempotent).toBe(true);
  });
});
