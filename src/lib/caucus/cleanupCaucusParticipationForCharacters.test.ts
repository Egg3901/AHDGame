import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

describe("cleanupCaucusParticipationForCharacters", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
  });

  it("withdraws caucus-chair candidacies and deletes votes for removed characters", async () => {
    const characterId = new ObjectId();
    const caucusId = new ObjectId();

    db.collection("caucusChairCandidates").updateMany.mockResolvedValue({
      modifiedCount: 1,
    } as never);
    db.collection("caucusChairVotes").deleteMany.mockResolvedValue({ deletedCount: 3 } as never);
    db.collection("caucuses").updateMany.mockResolvedValue({ modifiedCount: 0 } as never);

    const { cleanupCaucusParticipationForCharacters } =
      await import("./cleanupCaucusParticipationForCharacters");
    const result = await cleanupCaucusParticipationForCharacters(
      db as unknown as Db,
      [characterId],
      {
        caucusId,
        removeMembership: false,
      }
    );

    expect(result.candidaciesWithdrawn).toBe(1);
    expect(result.votesDeleted).toBe(3);
    expect(db.collection("caucusChairCandidates").updateMany).toHaveBeenCalledWith(
      { characterId: { $in: [characterId] }, status: "active", caucusId },
      { $set: { status: "withdrawn", withdrawnAt: expect.any(Date) } }
    );
    expect(db.collection("caucusChairVotes").deleteMany).toHaveBeenCalledWith({
      caucusId,
      $or: [{ voterId: { $in: [characterId] } }, { candidateId: { $in: [characterId] } }],
    });
  });

  it("closes active caucus memberships and clears faction and leadership pointers when requested", async () => {
    const characterId = new ObjectId();
    const caucusId = new ObjectId();
    const membershipId = new ObjectId();

    db.collection("caucusMemberships").find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        {
          _id: membershipId,
          caucusId,
          memberType: "character",
          memberId: characterId,
          status: "active",
        },
      ]),
    });
    db.collection("caucusMemberships").updateMany.mockResolvedValue({ modifiedCount: 1 } as never);
    db.collection("characters").updateMany.mockResolvedValue({ modifiedCount: 1 } as never);
    db.collection("caucuses")
      .updateMany.mockResolvedValueOnce({ modifiedCount: 1 } as never)
      .mockResolvedValueOnce({ modifiedCount: 1 } as never);

    const { cleanupCaucusParticipationForCharacters } =
      await import("./cleanupCaucusParticipationForCharacters");
    const result = await cleanupCaucusParticipationForCharacters(
      db as unknown as Db,
      [characterId],
      {
        removeMembership: true,
        membershipStatus: "removed",
      }
    );

    expect(result.membershipsClosed).toBe(1);
    expect(result.factionIdsCleared).toBe(1);
    expect(result.chairSeatsCleared).toBe(1);
    expect(result.viceChairSeatsCleared).toBe(1);
    expect(db.collection("caucusMemberships").updateMany).toHaveBeenCalledWith(
      { _id: { $in: [membershipId] } },
      {
        $set: {
          status: "removed",
          leftAt: expect.any(Date),
          updatedAt: expect.any(Date),
        },
      }
    );
    expect(db.collection("characters").updateMany).toHaveBeenCalledWith(
      { _id: { $in: [characterId] }, factionId: { $in: [caucusId] } },
      { $set: { factionId: null, updatedAt: expect.any(Date) } }
    );
  });
});
