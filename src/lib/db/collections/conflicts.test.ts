import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import {
  listActiveConflicts,
  listResolvedConflicts,
  getConflict,
  conflictExists,
  listConflictsForCountry,
  getConflictByNumber,
} from "./conflicts";

describe("conflicts collection", () => {
  let db: MockDb;
  beforeEach(() => {
    db = createMockDb();
    db.collection("conflicts");
  });

  it("listActiveConflicts filters out resolved", async () => {
    const cursor = { toArray: vi.fn().mockResolvedValue([{ _id: "c1" }]) };
    db.collectionMocks.conflicts.find = vi.fn().mockReturnValue(cursor);
    const out = await listActiveConflicts(db as unknown as Db);
    expect(db.collectionMocks.conflicts.find).toHaveBeenCalledWith({ status: { $ne: "resolved" } });
    expect(out).toEqual([{ _id: "c1" }]);
  });

  // The historical list is the one reader that WANTS resolved wars, newest ending
  // first, and it is a bounded page rather than the whole archive.
  it("listResolvedConflicts lists resolved wars, latest ending first, capped", async () => {
    const toArray = vi.fn().mockResolvedValue([{ _id: "c2" }, { _id: "c1" }]);
    const limit = vi.fn().mockReturnValue({ toArray });
    const sort = vi.fn().mockReturnValue({ limit });
    db.collectionMocks.conflicts.find = vi.fn().mockReturnValue({ sort });
    const out = await listResolvedConflicts(db as unknown as Db, 25);
    expect(db.collectionMocks.conflicts.find).toHaveBeenCalledWith({ status: "resolved" });
    expect(sort).toHaveBeenCalledWith({ endTurn: -1, conflictId: -1 });
    expect(limit).toHaveBeenCalledWith(25);
    expect(out).toEqual([{ _id: "c2" }, { _id: "c1" }]);
  });

  it("getConflict returns the doc", async () => {
    db.collectionMocks.conflicts.findOne.mockResolvedValue({ _id: "c1" });
    expect(await getConflict(db as unknown as Db, "c1")).toEqual({ _id: "c1" });
  });

  it("conflictExists is true when a doc matches, false otherwise", async () => {
    db.collectionMocks.conflicts.countDocuments.mockResolvedValueOnce(1);
    expect(await conflictExists(db as unknown as Db, "c1")).toBe(true);
    db.collectionMocks.conflicts.countDocuments.mockResolvedValueOnce(0);
    expect(await conflictExists(db as unknown as Db, "nope")).toBe(false);
  });

  it("listConflictsForCountry matches host or either side, active only", async () => {
    const cursor = { toArray: vi.fn().mockResolvedValue([]) };
    db.collectionMocks.conflicts.find = vi.fn().mockReturnValue(cursor);
    await listConflictsForCountry(db as unknown as Db, "US");
    const filter = db.collectionMocks.conflicts.find.mock.calls[0][0];
    expect(filter.status).toEqual({ $ne: "resolved" });
    expect(filter.$or).toEqual([
      { hostCountry: "US" },
      { "sideA.countries": "US" },
      { "sideB.countries": "US" },
    ]);
  });
  // A resolved war keeps its page — that is the historical point — so this lookup
  // must NOT filter on status the way listActiveConflicts does.
  it("getConflictByNumber finds a conflict whatever its status", async () => {
    db.collectionMocks.conflicts.findOne.mockResolvedValue({
      _id: "c1",
      conflictId: 3,
      status: "resolved",
    });
    const out = await getConflictByNumber(db as unknown as Db, 3);
    expect(out).toMatchObject({ conflictId: 3, status: "resolved" });
    expect(db.collectionMocks.conflicts.findOne).toHaveBeenCalledWith({ conflictId: 3 });
  });

  it("getConflictByNumber returns null for an unknown number", async () => {
    db.collectionMocks.conflicts.findOne.mockResolvedValue(null);
    expect(await getConflictByNumber(db as unknown as Db, 99)).toBeNull();
  });
});
