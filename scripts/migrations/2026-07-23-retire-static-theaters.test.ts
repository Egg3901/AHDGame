/**
 * Tests for the retire-static-theaters migration (dynamic-conflict model, sub-A).
 *
 * Verifies:
 *   1. Units at a retired theater are reset to reserve; formations' assignments cleared;
 *      battleDeclarations / battleReports / theaterState dropped.
 *   2. Reports the counts of what was changed.
 *   3. Idempotent: with nothing keyed to a retired theater, no writes are issued.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("../utils/db", () => ({
  connectDb: vi.fn(),
  closeDb: vi.fn().mockResolvedValue(undefined),
}));

import { applyRetireStaticTheaters } from "./2026-07-23-retire-static-theaters";

describe("applyRetireStaticTheaters", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("militaryUnits");
    db.collection("militaryFormations");
    db.collection("battleDeclarations");
    db.collection("battleReports");
    db.collection("theaterState");
  });

  it("resets units, clears assignments, and drops battle state", async () => {
    db.collectionMocks.militaryUnits.countDocuments.mockResolvedValue(2);
    db.collectionMocks.militaryFormations.countDocuments.mockResolvedValue(1);
    db.collectionMocks.battleDeclarations.countDocuments.mockResolvedValue(3);
    db.collectionMocks.battleReports.countDocuments.mockResolvedValue(4);
    db.collectionMocks.theaterState.countDocuments.mockResolvedValue(5);

    const r = await applyRetireStaticTheaters(db as unknown as Db);

    expect(r).toEqual({
      unitsReset: 2,
      formationsCleared: 1,
      declarationsDropped: 3,
      reportsDropped: 4,
      theaterStatesDropped: 5,
    });

    // units at a non-reserve theater return home
    expect(db.collectionMocks.militaryUnits.updateMany).toHaveBeenCalledWith(
      { theaterId: { $ne: "reserve" } },
      { $set: { theaterId: "reserve" } }
    );
    // formations with any posting have their assignments cleared
    expect(db.collectionMocks.militaryFormations.updateMany).toHaveBeenCalledWith(
      { "conflictAssignments.0": { $exists: true } },
      { $set: { conflictAssignments: [] } }
    );
    // battle state keyed to retired theaters is dropped wholesale
    expect(db.collectionMocks.battleDeclarations.deleteMany).toHaveBeenCalledWith({});
    expect(db.collectionMocks.battleReports.deleteMany).toHaveBeenCalledWith({});
    expect(db.collectionMocks.theaterState.deleteMany).toHaveBeenCalledWith({});
  });

  it("is idempotent: nothing keyed to a retired theater → no writes", async () => {
    db.collectionMocks.militaryUnits.countDocuments.mockResolvedValue(0);
    db.collectionMocks.militaryFormations.countDocuments.mockResolvedValue(0);
    db.collectionMocks.battleDeclarations.countDocuments.mockResolvedValue(0);
    db.collectionMocks.battleReports.countDocuments.mockResolvedValue(0);
    db.collectionMocks.theaterState.countDocuments.mockResolvedValue(0);

    const r = await applyRetireStaticTheaters(db as unknown as Db);

    expect(r.unitsReset).toBe(0);
    expect(db.collectionMocks.militaryUnits.updateMany).not.toHaveBeenCalled();
    expect(db.collectionMocks.militaryFormations.updateMany).not.toHaveBeenCalled();
    expect(db.collectionMocks.battleDeclarations.deleteMany).not.toHaveBeenCalled();
    expect(db.collectionMocks.battleReports.deleteMany).not.toHaveBeenCalled();
    expect(db.collectionMocks.theaterState.deleteMany).not.toHaveBeenCalled();
  });
});
