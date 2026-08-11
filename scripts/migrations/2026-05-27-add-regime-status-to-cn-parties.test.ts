/**
 * Tests for the regimeStatus backfill migration.
 *
 * Verifies:
 *   1. Maps CN sequentialIds correctly: 1 -> "ruling", 2 -> "approved", 3 -> "approved".
 *   2. Scopes the query to CN only.
 *   3. Idempotent: skips parties that already have a non-null regimeStatus.
 *   4. Skips CN parties with unrecognised sequentialIds (defensive).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

// Stub the db utilities so importing the migration does not trip on a
// missing MONGODB_URI. The pure `applyRegimeStatusBackfill` function takes
// a `Db` directly, so the connectDb/closeDb pair is not called here.
vi.mock("../utils/db", () => ({
  connectDb: vi.fn(),
  closeDb: vi.fn().mockResolvedValue(undefined),
}));

import { applyRegimeStatusBackfill } from "./2026-05-27-add-regime-status-to-cn-parties";

function makeCursor(docs: unknown[]) {
  return { toArray: vi.fn().mockResolvedValue(docs) };
}

describe("applyRegimeStatusBackfill", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("politicalParties"); // pre-create
  });

  it("maps CN sequentialIds to the correct regime status", async () => {
    const ccp = { _id: new ObjectId(), countryId: "CN", sequentialId: 1, name: "CCP" };
    const cdl = { _id: new ObjectId(), countryId: "CN", sequentialId: 2, name: "CDL" };
    const cndca = { _id: new ObjectId(), countryId: "CN", sequentialId: 3, name: "CNDCA" };

    db.collectionMocks.politicalParties.find.mockReturnValue(makeCursor([ccp, cdl, cndca]));

    const result = await applyRegimeStatusBackfill(db as unknown as Db);

    expect(result.scanned).toBe(3);
    expect(result.modified).toBe(3);
    expect(result.skipped).toBe(0);

    const updateCalls = db.collectionMocks.politicalParties.updateOne.mock.calls;
    expect(updateCalls).toHaveLength(3);

    const findUpdate = (id: ObjectId) =>
      updateCalls.find((call: unknown[]) => {
        const filter = call[0] as { _id: ObjectId };
        return filter._id.toString() === id.toString();
      });
    const getSetRegime = (call: unknown[] | undefined) =>
      (call?.[1] as { $set?: { regimeStatus?: string } } | undefined)?.$set?.regimeStatus;

    expect(getSetRegime(findUpdate(ccp._id))).toBe("ruling");
    expect(getSetRegime(findUpdate(cdl._id))).toBe("approved");
    expect(getSetRegime(findUpdate(cndca._id))).toBe("approved");
  });

  it("scopes the query to CN parties only", async () => {
    db.collectionMocks.politicalParties.find.mockReturnValue(makeCursor([]));
    await applyRegimeStatusBackfill(db as unknown as Db);
    expect(db.collectionMocks.politicalParties.find).toHaveBeenCalledWith({ countryId: "CN" });
  });

  it("skips parties that already have a regimeStatus (idempotent on re-run)", async () => {
    const ccp = { _id: new ObjectId(), countryId: "CN", sequentialId: 1, name: "CCP" };
    const cdl = {
      _id: new ObjectId(),
      countryId: "CN",
      sequentialId: 2,
      name: "CDL",
      regimeStatus: "banned",
    };
    const cndca = { _id: new ObjectId(), countryId: "CN", sequentialId: 3, name: "CNDCA" };

    db.collectionMocks.politicalParties.find.mockReturnValue(makeCursor([ccp, cdl, cndca]));

    const result = await applyRegimeStatusBackfill(db as unknown as Db);

    expect(result.scanned).toBe(3);
    expect(result.modified).toBe(2);
    expect(result.skipped).toBe(1);

    const updateCalls = db.collectionMocks.politicalParties.updateOne.mock.calls;
    expect(updateCalls).toHaveLength(2);

    // CDL should not be among the updates (its regimeStatus was preserved)
    const cdlUpdate = updateCalls.find((call: unknown[]) => {
      const filter = call[0] as { _id: ObjectId };
      return filter._id.toString() === cdl._id.toString();
    });
    expect(cdlUpdate).toBeUndefined();
  });

  it("skips CN parties with unrecognised sequentialIds", async () => {
    const oddParty = {
      _id: new ObjectId(),
      countryId: "CN",
      sequentialId: 99,
      name: "Mystery Party",
    };
    db.collectionMocks.politicalParties.find.mockReturnValue(makeCursor([oddParty]));

    const result = await applyRegimeStatusBackfill(db as unknown as Db);

    expect(result.scanned).toBe(1);
    expect(result.modified).toBe(0);
    expect(result.skipped).toBe(1);
    expect(db.collectionMocks.politicalParties.updateOne).not.toHaveBeenCalled();
  });
});
