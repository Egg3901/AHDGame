/**
 * Regression test for ticket #0860 — seedLegislationTypes previously did a
 * destructive drop()+insertMany on every call, so new reference entries
 * (e.g. UK agriculture/technology) never reached a live world unless it was
 * fully reseeded after the entries were added. Now upserts by _id instead,
 * and must never delete admin-authored custom types (source: "admin").
 */
import { describe, expect, it, vi } from "vitest";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { seedLegislationTypes } from "./seedLegislationTypes";
import { legislationTypes } from "@/lib/seeds/reference/legislationTypes";

describe("seedLegislationTypes", () => {
  it("upserts every reference entry by _id instead of dropping the collection", async () => {
    const db = createMockDb() as unknown as MockDb;
    const collection = db.collection("legislationTypes");
    // The real driver supports drop(); the shared mock doesn't stub it by
    // default, so attach a spy to prove the (now-removed) call never fires.
    collection.drop = vi.fn().mockResolvedValue(undefined);

    await seedLegislationTypes(db as never, false, vi.fn(), "2019-default");

    expect(collection.drop).not.toHaveBeenCalled();
    expect(collection.bulkWrite).toHaveBeenCalledTimes(1);
    const ops = collection.bulkWrite.mock.calls[0][0] as Array<{
      replaceOne: { filter: { _id: string }; upsert: boolean };
    }>;
    // Every op is an upsert-by-_id — the point of #0860. The seed SET itself is
    // asserted in seedPoliticalLegislation.test.ts (old playable catalogs out,
    // projected new-generation catalogs in, on every preset).
    expect(ops.length).toBeGreaterThan(0);
    for (const op of ops) {
      expect(op.replaceOne.upsert).toBe(true);
      expect(op.replaceOne.filter._id).toBeTruthy();
    }
    // A non-playable reference entry still seeds verbatim.
    const jp = legislationTypes.find((t) => t.countryScope === "jp")!;
    expect(ops.some((op) => op.replaceOne.filter._id === jp._id)).toBe(true);
  });

  it("prunes stale reference-origin docs but never touches admin-authored types", async () => {
    const db = createMockDb() as unknown as MockDb;
    const collection = db.collection("legislationTypes");

    await seedLegislationTypes(db as never, false, vi.fn(), "2019-default");

    // The prune set must be exactly what was just seeded — deriving it from the
    // bulkWrite keeps this honest if the seed set changes shape again.
    const seededIds = (
      collection.bulkWrite.mock.calls[0][0] as Array<{ replaceOne: { filter: { _id: string } } }>
    ).map((op) => op.replaceOne.filter._id);
    expect(collection.deleteMany).toHaveBeenCalledWith({
      _id: { $nin: seededIds },
      source: { $ne: "admin" },
    });
  });

  it("does not drop committeeAssignments/stateBills unless reset is true", async () => {
    const db = createMockDb() as unknown as MockDb;
    const committeeAssignments = db.collection("committeeAssignments");
    committeeAssignments.drop = vi.fn().mockResolvedValue(undefined);

    await seedLegislationTypes(db as never, false, vi.fn(), "2019-default");
    expect(committeeAssignments.drop).not.toHaveBeenCalled();
    expect(db.collection("stateBills").deleteMany).not.toHaveBeenCalled();

    await seedLegislationTypes(db as never, true, vi.fn(), "2019-default");
    expect(committeeAssignments.drop).toHaveBeenCalled();
    expect(db.collection("stateBills").deleteMany).toHaveBeenCalledWith({});
  });
});
