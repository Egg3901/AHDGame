import { describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import { createMockDb } from "@/lib/test-utils/mockDb";
import { syncDenormalizedNppName } from "./syncDenormalizedName";

describe("syncDenormalizedNppName", () => {
  it("updates electionCandidates and electedOfficials characterName for the nppId", async () => {
    const db = createMockDb();
    db.collection("electionCandidates");
    db.collection("electedOfficials");
    db.collectionMocks.electionCandidates.updateMany.mockResolvedValue({ modifiedCount: 3 });
    db.collectionMocks.electedOfficials.updateMany.mockResolvedValue({ modifiedCount: 1 });

    const nppId = new ObjectId();
    const result = await syncDenormalizedNppName(db as unknown as Db, nppId, "Count Binface");

    expect(result).toEqual({ candidaciesUpdated: 3, officialsUpdated: 1 });
    expect(db.collectionMocks.electionCandidates.updateMany).toHaveBeenCalledWith(
      { nppId },
      { $set: { characterName: "Count Binface" } }
    );
    expect(db.collectionMocks.electedOfficials.updateMany).toHaveBeenCalledWith(
      { nppId },
      { $set: { characterName: "Count Binface" } }
    );
  });
});
