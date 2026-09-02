import { beforeEach, describe, expect, it } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { applyPlayerWhipToImpeachment } from "./applyPlayerWhip";

function makeImpeachment(overrides: Record<string, unknown> = {}) {
  return {
    _id: new ObjectId(),
    countryId: "US",
    targetName: "The President",
    targetOffice: "president",
    stage: "house",
    houseVotes: {},
    houseVotesFor: 0,
    houseVotesAgainst: 0,
    houseVotesAbstain: 0,
    senateVotes: {},
    senateVotesFor: 0,
    senateVotesAgainst: 0,
    senateVotesAbstain: 0,
    ...overrides,
  };
}

describe("applyPlayerWhipToImpeachment", () => {
  let db: MockDb;

  beforeEach(() => {
    db = createMockDb();
    db.collection("impeachments");
    db.collection("electedOfficials");
  });

  it("force-casts aye and snapshots the prior ballot in bill-vote semantics", async () => {
    const c1 = new ObjectId();
    const c2 = new ObjectId();
    const impeachment = makeImpeachment({
      houseVotes: { [c1.toString()]: "nay" },
      houseVotesAgainst: 1,
    });
    db.collectionMocks["impeachments"]!.findOne.mockResolvedValue(impeachment);

    const result = await applyPlayerWhipToImpeachment(db as unknown as Db, impeachment._id, "for", [
      c1,
      c2,
    ]);

    expect(result).toEqual({ overridden: 2, alreadyAligned: 0 });
    const [, update] = db.collectionMocks["impeachments"]!.updateOne.mock.calls[0] as [
      unknown,
      { $set: Record<string, unknown>; $inc: Record<string, number> },
    ];
    expect(update.$set[`houseVotes.${c1.toString()}`]).toBe("aye");
    expect(update.$set[`houseVotes.${c2.toString()}`]).toBe("aye");
    // "nay" reads back as "against" so the revert affordance matches bills.
    expect(update.$set[`whippedFromVote.${c1.toString()}`]).toBe("against");
    expect(update.$set[`whippedFromVote.${c2.toString()}`]).toBe("unvoted");
    expect(update.$inc).toEqual({ houseVotesFor: 2, houseVotesAgainst: -1 });
  });

  it("preserves an abstention in the snapshot", async () => {
    const c1 = new ObjectId();
    const impeachment = makeImpeachment({
      houseVotes: { [c1.toString()]: "abstain" },
      houseVotesAbstain: 1,
    });
    db.collectionMocks["impeachments"]!.findOne.mockResolvedValue(impeachment);

    await applyPlayerWhipToImpeachment(db as unknown as Db, impeachment._id, "against", [c1]);

    const [, update] = db.collectionMocks["impeachments"]!.updateOne.mock.calls[0] as [
      unknown,
      { $set: Record<string, unknown>; $inc: Record<string, number> },
    ];
    expect(update.$set[`whippedFromVote.${c1.toString()}`]).toBe("abstain");
    expect(update.$inc).toEqual({ houseVotesAgainst: 1, houseVotesAbstain: -1 });
  });

  it("targets the senate map during the trial stage", async () => {
    const c1 = new ObjectId();
    const impeachment = makeImpeachment({ stage: "senate" });
    db.collectionMocks["impeachments"]!.findOne.mockResolvedValue(impeachment);

    await applyPlayerWhipToImpeachment(db as unknown as Db, impeachment._id, "for", [c1]);

    const [filter, update] = db.collectionMocks["impeachments"]!.updateOne.mock.calls[0] as [
      Record<string, unknown>,
      { $set: Record<string, unknown> },
    ];
    expect(filter).toEqual({ _id: impeachment._id, stage: "senate" });
    expect(update.$set[`senateVotes.${c1.toString()}`]).toBe("aye");
  });

  it("no-ops once the case is resolved", async () => {
    db.collectionMocks["impeachments"]!.findOne.mockResolvedValue(
      makeImpeachment({ stage: "acquitted" })
    );

    const result = await applyPlayerWhipToImpeachment(db as unknown as Db, new ObjectId(), "for", [
      new ObjectId(),
    ]);

    expect(result).toEqual({ overridden: 0, alreadyAligned: 0 });
    expect(db.collectionMocks["impeachments"]!.updateOne).not.toHaveBeenCalled();
  });

  it("no-ops when no eligible characters are seated", async () => {
    const result = await applyPlayerWhipToImpeachment(
      db as unknown as Db,
      new ObjectId(),
      "for",
      []
    );
    expect(result).toEqual({ overridden: 0, alreadyAligned: 0 });
  });
});
