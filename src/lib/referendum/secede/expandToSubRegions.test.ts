import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { expandToSubRegions } from "./expandToSubRegions";
import { scoRegions } from "@/lib/seeds/sco/scoRegions";

describe("expandToSubRegions — structural", () => {
  let db: MockDb;
  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
  });

  it("inserts the 7 SCO sub-regions and deletes the aggregate states doc", async () => {
    // Aggregate "SCO" state exists; capital sub-region does not yet.
    db.collection("states").findOne.mockImplementation(async (q: { _id: string }) =>
      q._id === "SCO" ? { _id: "SCO", countryId: "SCO", population: 5_440_000 } : null
    );

    const res = await expandToSubRegions(db as unknown as Db, "SCO");

    const insertMany = db.collectionMocks["states"]!.insertMany;
    expect(insertMany).toHaveBeenCalledTimes(1);
    const inserted = insertMany.mock.calls[0][0] as Array<{ _id: string }>;
    expect(inserted.map((s) => s._id).sort()).toEqual(scoRegions.map((s) => s._id).sort());
    expect(db.collectionMocks["states"]!.deleteOne).toHaveBeenCalledWith({ _id: "SCO" });
    expect(res.inserted).toBe(7);
  });

  it("is a no-op when sub-regions already exist (capital present)", async () => {
    db.collection("states").findOne.mockImplementation(async (q: { _id: string }) =>
      q._id === "LOT" ? { _id: "LOT", countryId: "SCO" } : null
    );

    const res = await expandToSubRegions(db as unknown as Db, "SCO");

    expect(db.collectionMocks["states"]!.insertMany).not.toHaveBeenCalled();
    expect(res.inserted).toBe(0);
    expect(res.skipped).toBe("already-expanded");
  });
});
