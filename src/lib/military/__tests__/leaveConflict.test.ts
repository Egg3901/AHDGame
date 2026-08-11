import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Db } from "mongodb";
import { standDownCountry } from "../leaveConflict";

const reconcileSpy = vi.fn();
const formationsSpy = vi.fn();
let assignments: Array<{ theaterId: string; generalCharacterId: string }> = [];

vi.mock("@/lib/military/reconcileTheaters", () => ({
  reconcileUnitTheaters: (...a: unknown[]) => {
    reconcileSpy(...a);
    return Promise.resolve();
  },
}));
vi.mock("@/lib/db/collections/militaryFormations", () => ({
  getMilitaryFormations: async () => ({ conflictAssignments: assignments }),
  getMilitaryFormationsCollection: () => ({
    updateOne: (...a: unknown[]) => {
      formationsSpy(...a);
      return Promise.resolve({ modifiedCount: 1 });
    },
  }),
}));

const db = {} as Db;
const conflict = { _id: "war1" };

beforeEach(() => {
  vi.clearAllMocks();
  assignments = [
    { theaterId: "war1", generalCharacterId: "g1" },
    { theaterId: "other", generalCharacterId: "g2" },
  ];
});

describe("standDownCountry", () => {
  it("drops only this theater's postings, keeping the rest", async () => {
    await standDownCountry(db, conflict, "UK");
    const [, update] = formationsSpy.mock.calls[0];
    expect(
      (update as { $set: { conflictAssignments: unknown[] } }).$set.conflictAssignments
    ).toEqual([{ theaterId: "other", generalCharacterId: "g2" }]);
  });

  it("scopes the write to the country standing down", async () => {
    await standDownCountry(db, conflict, "UK");
    const [filter] = formationsSpy.mock.calls[0];
    expect(filter).toEqual({ countryId: "UK" });
  });

  it("reconciles with the KEPT postings, not the old ones", async () => {
    // Reconcile derives unit.theaterId from the postings it is handed. Passing the
    // pre-filter list would re-post every unit to the war just left.
    await standDownCountry(db, conflict, "UK");
    expect(reconcileSpy).toHaveBeenCalledWith(expect.anything(), "UK", [
      { theaterId: "other", generalCharacterId: "g2" },
    ]);
  });

  it("writes nothing when the country had no postings there", async () => {
    assignments = [{ theaterId: "other", generalCharacterId: "g2" }];
    await standDownCountry(db, conflict, "UK");
    expect(formationsSpy).not.toHaveBeenCalled();
  });

  it("still reconciles when there was nothing to drop", async () => {
    // unit.theaterId is a CACHE of the posting, so a unit can be pointing at this
    // theater even with no posting left to remove.
    assignments = [{ theaterId: "other", generalCharacterId: "g2" }];
    await standDownCountry(db, conflict, "UK");
    expect(reconcileSpy).toHaveBeenCalled();
  });

  it("clears every posting when they were all at this theater", async () => {
    assignments = [
      { theaterId: "war1", generalCharacterId: "g1" },
      { theaterId: "war1", generalCharacterId: "g3" },
    ];
    await standDownCountry(db, conflict, "UK");
    const [, update] = formationsSpy.mock.calls[0];
    expect(
      (update as { $set: { conflictAssignments: unknown[] } }).$set.conflictAssignments
    ).toEqual([]);
    expect(reconcileSpy).toHaveBeenCalledWith(expect.anything(), "UK", []);
  });
});
