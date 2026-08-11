import { beforeEach, describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { castLeadershipVoteBallot } from "@/lib/congress/leadershipVoteBallots";

let db: MockDb;

beforeEach(() => {
  db = createMockDb();
  db.collection("houseLeadershipBallots");
  db.collection("houseLeadershipNominations");
});

describe("leadershipVoteBallots", () => {
  it("moves a voter from the previous nomination to the new nomination atomically", async () => {
    const voterCharacterId = new ObjectId();
    const previousNominationId = new ObjectId();
    const nextNominationId = new ObjectId();
    const now = new Date("2026-04-29T21:30:00Z");

    db.collectionMocks["houseLeadershipBallots"]!.findOneAndUpdate.mockResolvedValue({
      nominationId: previousNominationId,
    });
    db.collectionMocks["houseLeadershipBallots"]!.findOne.mockResolvedValue({
      nominationId: nextNominationId,
      ballotToken: "token-1",
    });

    const result = await castLeadershipVoteBallot(db as never, {
      ballotCollectionName: "houseLeadershipBallots",
      nominationCollectionName: "houseLeadershipNominations",
      nominationId: nextNominationId,
      voterCharacterId,
      role: "majority_leader",
      now,
      ballotToken: "token-1",
    });

    expect(result.previousNominationId?.equals(previousNominationId)).toBe(true);
    expect(db.collectionMocks["houseLeadershipNominations"]!.updateOne).toHaveBeenNthCalledWith(
      1,
      {
        _id: previousNominationId,
        role: "majority_leader",
        status: { $in: ["open", "voting"] },
        [`votes.${voterCharacterId.toString()}`]: { $exists: true },
      },
      expect.objectContaining({
        $unset: { [`votes.${voterCharacterId.toString()}`]: "" },
        $inc: { votesFor: -1 },
      })
    );
    expect(db.collectionMocks["houseLeadershipNominations"]!.updateOne).toHaveBeenNthCalledWith(
      2,
      {
        _id: nextNominationId,
        role: "majority_leader",
        status: { $in: ["open", "voting"] },
        [`votes.${voterCharacterId.toString()}`]: { $exists: false },
      },
      expect.objectContaining({
        $set: expect.objectContaining({
          [`votes.${voterCharacterId.toString()}`]: "for",
          status: "voting",
        }),
        $inc: { votesFor: 1 },
      })
    );
  });
});
