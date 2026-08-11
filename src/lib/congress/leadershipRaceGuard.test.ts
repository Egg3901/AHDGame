import { beforeEach, describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import {
  describeLeadershipConflict,
  failNominationIfLeadershipConflict,
} from "@/lib/congress/leadershipRaceGuard";

let db: MockDb;

beforeEach(() => {
  db = createMockDb();
  db.collection("speakerNominations");
  db.collection("houseLeadershipNominations");
  db.collection("senateLeadershipNominations");
});

describe("leadershipRaceGuard", () => {
  it("fails the current nomination when another active leadership race already exists", async () => {
    const nomineeId = new ObjectId();
    const currentNominationId = new ObjectId();
    const conflictingSpeakerId = new ObjectId();

    db.collectionMocks["speakerNominations"]!.findOne.mockResolvedValue({
      _id: conflictingSpeakerId,
    });
    db.collectionMocks["houseLeadershipNominations"]!.findOne.mockResolvedValue({
      _id: currentNominationId,
      role: "majority_leader",
    });
    db.collectionMocks["senateLeadershipNominations"]!.findOne.mockResolvedValue(null);

    const conflict = await failNominationIfLeadershipConflict(db as never, {
      collectionName: "houseLeadershipNominations",
      nominationId: currentNominationId,
      nomineeId,
      now: new Date("2026-04-29T21:00:00Z"),
    });

    expect(conflict).toMatchObject({
      collectionName: "speakerNominations",
      nominationId: conflictingSpeakerId,
    });
    expect(describeLeadershipConflict(conflict)).toContain("Withdraw from Speaker first");
    expect(db.collectionMocks["houseLeadershipNominations"]!.updateOne).toHaveBeenCalledWith(
      {
        _id: currentNominationId,
        status: { $in: ["open", "voting"] },
      },
      expect.objectContaining({
        $set: expect.objectContaining({ status: "failed" }),
      })
    );
  });

  it("leaves the nomination active when no cross-race conflict exists", async () => {
    const nomineeId = new ObjectId();
    const currentNominationId = new ObjectId();

    db.collectionMocks["speakerNominations"]!.findOne.mockResolvedValue(null);
    db.collectionMocks["houseLeadershipNominations"]!.findOne.mockResolvedValue({
      _id: currentNominationId,
      role: "majority_leader",
    });
    db.collectionMocks["senateLeadershipNominations"]!.findOne.mockResolvedValue(null);

    const conflict = await failNominationIfLeadershipConflict(db as never, {
      collectionName: "houseLeadershipNominations",
      nominationId: currentNominationId,
      nomineeId,
      now: new Date("2026-04-29T21:00:00Z"),
    });

    expect(conflict).toBeNull();
    expect(db.collectionMocks["houseLeadershipNominations"]!.updateOne).not.toHaveBeenCalled();
  });
});
