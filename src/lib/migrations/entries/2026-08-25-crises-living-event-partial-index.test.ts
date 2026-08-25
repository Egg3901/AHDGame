import type { Db } from "mongodb";
import { describe, expect, it, vi } from "vitest";
import { createMockDb, type MockCollection } from "@/lib/test-utils/mockDb";
import { migration } from "./2026-08-25-crises-living-event-partial-index";

type IndexedMockCollection = MockCollection & {
  indexes: ReturnType<typeof vi.fn>;
  dropIndex: ReturnType<typeof vi.fn>;
};

function crisesWith(
  indexes: unknown[],
  nullKeyed: number
): {
  db: Db;
  crises: IndexedMockCollection;
} {
  const db = createMockDb();
  const crises = db.collection("crises") as unknown as IndexedMockCollection;
  crises.indexes = vi.fn().mockResolvedValue(indexes);
  crises.dropIndex = vi.fn().mockResolvedValue(undefined);
  crises.countDocuments.mockResolvedValue(nullKeyed);
  crises.updateMany.mockResolvedValue({ modifiedCount: nullKeyed });
  crises.createIndex.mockResolvedValue("crises_living_event");
  return { db: db as unknown as Db, crises };
}

const LEGACY_INDEX = {
  name: "crises_living_event",
  key: { livingConflictEventId: 1 },
  unique: true,
  sparse: true,
};

const PARTIAL_INDEX = {
  ...LEGACY_INDEX,
  sparse: undefined,
  partialFilterExpression: { livingConflictEventId: { $type: "string" } },
};

describe(migration.id, () => {
  it("dry run reads but never writes", async () => {
    const { db, crises } = crisesWith([LEGACY_INDEX], 1);
    const result = await migration.execute(db, { dryRun: true });
    expect(result.documentsScanned).toBe(1);
    expect(crises.updateMany).not.toHaveBeenCalled();
    expect(crises.dropIndex).not.toHaveBeenCalled();
    expect(crises.createIndex).not.toHaveBeenCalled();
  });

  it("unsets null keys and rebuilds the legacy sparse index as partial", async () => {
    const { db, crises } = crisesWith([LEGACY_INDEX], 1);
    const result = await migration.execute(db, { dryRun: false });
    expect(crises.updateMany).toHaveBeenCalledWith(
      { livingConflictEventId: null },
      { $unset: { livingConflictEventId: "" } }
    );
    expect(crises.dropIndex).toHaveBeenCalledWith("crises_living_event");
    expect(crises.createIndex).toHaveBeenCalledWith(
      { livingConflictEventId: 1 },
      expect.objectContaining({
        unique: true,
        partialFilterExpression: { livingConflictEventId: { $type: "string" } },
      })
    );
    expect(result.documentsUpdated).toBe(1);
  });

  it("is a no-op when the index is already partial and no null keys exist", async () => {
    const { db, crises } = crisesWith([PARTIAL_INDEX], 0);
    await migration.execute(db, { dryRun: false });
    expect(crises.updateMany).not.toHaveBeenCalled();
    expect(crises.dropIndex).not.toHaveBeenCalled();
    expect(crises.createIndex).not.toHaveBeenCalled();
  });

  it("creates the partial index when none exists", async () => {
    const { db, crises } = crisesWith([], 0);
    await migration.execute(db, { dryRun: false });
    expect(crises.dropIndex).not.toHaveBeenCalled();
    expect(crises.createIndex).toHaveBeenCalledTimes(1);
  });
});
