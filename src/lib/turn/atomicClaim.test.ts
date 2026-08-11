import { describe, it, expect } from "vitest";
import type { Db } from "mongodb";
import { createMockDb } from "@/lib/test-utils/mockDb";
import { claimStatusTransition } from "./atomicClaim";

describe("claimStatusTransition", () => {
  it("returns true when the guarded update matches exactly one document", async () => {
    const db = createMockDb();
    db.collection("things");
    db.collectionMocks["things"]!.updateOne.mockResolvedValue({
      matchedCount: 1,
      modifiedCount: 1,
    });

    const won = await claimStatusTransition(
      db as unknown as Db,
      "things",
      { _id: "x", status: "voting" },
      { $set: { status: "closed" } }
    );

    expect(won).toBe(true);
  });

  it("returns false when no document matches the pre-state (concurrent loser)", async () => {
    const db = createMockDb();
    db.collection("things");
    db.collectionMocks["things"]!.updateOne.mockResolvedValue({
      matchedCount: 0,
      modifiedCount: 0,
    });

    const won = await claimStatusTransition(
      db as unknown as Db,
      "things",
      { _id: "x", status: "voting" },
      { $set: { status: "closed" } }
    );

    expect(won).toBe(false);
  });

  it("forwards the filter and update verbatim to updateOne on the named collection", async () => {
    const db = createMockDb();
    db.collection("things");
    const filter = { _id: "x", status: "voting" };
    const update = { $set: { status: "closed", updatedAt: new Date(0) } };

    await claimStatusTransition(db as unknown as Db, "things", filter, update);

    expect(db.collection).toHaveBeenCalledWith("things");
    expect(db.collectionMocks["things"]!.updateOne).toHaveBeenCalledWith(filter, update);
  });
});
