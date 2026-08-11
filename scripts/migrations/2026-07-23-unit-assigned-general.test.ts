/**
 * Tests for the W10 units-follow-general migration.
 *
 * Verifies:
 *   1. Backfills assignedGeneralId:null and $unsets the dead formationId.
 *   2. Reports the backfilled + already-migrated counts.
 *   3. Idempotent: with no un-backfilled docs, no update is issued.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("../utils/db", () => ({
  connectDb: vi.fn(),
  closeDb: vi.fn().mockResolvedValue(undefined),
}));

import { applyAssignedGeneralMigration } from "./2026-07-23-unit-assigned-general";

describe("applyAssignedGeneralMigration", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("militaryUnits");
  });

  it("backfills assignedGeneralId, resets theaterId to reserve, and unsets formationId", async () => {
    db.collectionMocks.militaryUnits.countDocuments
      .mockResolvedValueOnce(3) // to backfill
      .mockResolvedValueOnce(0); // already migrated

    const r = await applyAssignedGeneralMigration(db as unknown as Db);

    expect(r.backfilled).toBe(3);
    expect(r.alreadyMigrated).toBe(0);
    const call = db.collectionMocks.militaryUnits.updateMany.mock.calls[0];
    expect(call[0]).toEqual({ assignedGeneralId: { $exists: false } });
    const update = call[1] as { $set: Record<string, unknown>; $unset: Record<string, unknown> };
    expect(update.$set.assignedGeneralId).toBeNull();
    // A null-general unit's theater is unconditionally reserve; battle reads stored theaterId.
    expect(update.$set.theaterId).toBe("reserve");
    expect(update.$unset.formationId).toBe("");
  });

  it("is idempotent: nothing to backfill → no update issued", async () => {
    db.collectionMocks.militaryUnits.countDocuments
      .mockResolvedValueOnce(0) // to backfill
      .mockResolvedValueOnce(9); // already migrated

    const r = await applyAssignedGeneralMigration(db as unknown as Db);

    expect(r.backfilled).toBe(0);
    expect(r.alreadyMigrated).toBe(9);
    expect(db.collectionMocks.militaryUnits.updateMany).not.toHaveBeenCalled();
  });
});
