/**
 * Tests for the W1 militaryUnits field-unification migration.
 *
 * Verifies:
 *   1. Adds the unified fields (vet/xp/equipment/drill/theaterId/formationId) and $unsets location.
 *   2. Reports the legacy count and captures each legacy doc's location (rollback record).
 *   3. Idempotent: with no legacy docs (all already carry `vet`), no update is issued.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("../utils/db", () => ({
  connectDb: vi.fn(),
  closeDb: vi.fn().mockResolvedValue(undefined),
}));

import { applyUnifiedMilitaryFieldsMigration } from "./2026-07-14-unify-military-unit-fields";

function makeCursor(docs: unknown[]) {
  return { toArray: vi.fn().mockResolvedValue(docs) };
}

describe("applyUnifiedMilitaryFieldsMigration", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("militaryUnits");
  });

  it("adds unified fields, unsets location, and records legacy location samples", async () => {
    const legacy = { _id: new ObjectId(), countryId: "US", location: "state-42" };
    db.collectionMocks.militaryUnits.find.mockReturnValue(makeCursor([legacy]));
    db.collectionMocks.militaryUnits.countDocuments.mockResolvedValue(0);

    const r = await applyUnifiedMilitaryFieldsMigration(db as unknown as Db);

    expect(r.legacyFound).toBe(1);
    expect(r.alreadyMigrated).toBe(0);
    expect(r.locationSamples[legacy._id.toString()]).toBe("state-42");

    const call = db.collectionMocks.militaryUnits.updateMany.mock.calls[0];
    expect(call[0]).toEqual({ vet: { $exists: false } });
    const update = call[1] as {
      $set: Record<string, unknown>;
      $unset: Record<string, unknown>;
    };
    expect(update.$set.vet).toBe(1);
    expect(update.$set.xp).toBe(0);
    expect(update.$set.equipment).toEqual({ firepower: 1, protection: 1, support: 1 });
    expect(update.$set.drill).toBeNull();
    expect(update.$set.theaterId).toBe("reserve");
    expect(update.$set.formationId).toBeNull();
    expect(update.$unset.location).toBe("");
  });

  it("is idempotent: no legacy docs → no update issued", async () => {
    db.collectionMocks.militaryUnits.find.mockReturnValue(makeCursor([]));
    db.collectionMocks.militaryUnits.countDocuments.mockResolvedValue(5);

    const r = await applyUnifiedMilitaryFieldsMigration(db as unknown as Db);

    expect(r.legacyFound).toBe(0);
    expect(r.alreadyMigrated).toBe(5);
    expect(db.collectionMocks.militaryUnits.updateMany).not.toHaveBeenCalled();
  });
});
