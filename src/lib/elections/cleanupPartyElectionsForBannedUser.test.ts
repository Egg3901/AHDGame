import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

describe("cleanupPartyElectionsForBannedUser", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
  });

  it("returns zero counts when banned user has no characters", async () => {
    db.collection("characters").find.mockReturnValue({
      project: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([]),
    });

    const { cleanupPartyElectionsForBannedUser } =
      await import("./cleanupPartyElectionsForBannedUser");
    const result = await cleanupPartyElectionsForBannedUser(db as unknown as Db, new ObjectId());

    expect(result.characterIds).toEqual([]);
    expect(result.nationalPartyCandidatesWithdrawn).toBe(0);
    expect(result.nationalPartyVotesDeleted).toBe(0);
    expect(result.statePartyCandidatesWithdrawn).toBe(0);
    expect(result.statePartyVotesDeleted).toBe(0);
    expect(result.committeeCandidatesWithdrawn).toBe(0);
    expect(result.committeeVotesDeleted).toBe(0);
    expect(result.caucusChairCandidatesWithdrawn).toBe(0);
    expect(result.caucusChairVotesDeleted).toBe(0);

    // No write should have been issued.
    expect(db.collection("nationalPartyCandidates").updateMany).not.toHaveBeenCalled();
    expect(db.collection("nationalPartyVotes").deleteMany).not.toHaveBeenCalled();
    expect(db.collection("statePartyCandidates").updateMany).not.toHaveBeenCalled();
    expect(db.collection("statePartyVotes").deleteMany).not.toHaveBeenCalled();
    expect(db.collection("nationalCommitteeCandidates").updateMany).not.toHaveBeenCalled();
    expect(db.collection("nationalCommitteeVotes").deleteMany).not.toHaveBeenCalled();
    expect(db.collection("caucusChairCandidates").updateMany).not.toHaveBeenCalled();
    expect(db.collection("caucusChairVotes").deleteMany).not.toHaveBeenCalled();
  });

  it("withdraws candidacies and deletes votes across all three election types", async () => {
    const userId = new ObjectId();
    const charId = new ObjectId();

    db.collection("characters").find.mockReturnValue({
      project: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([{ _id: charId }]),
    });
    db.collection("nationalPartyCandidates").updateMany.mockResolvedValue({
      modifiedCount: 1,
    } as never);
    db.collection("nationalPartyVotes").deleteMany.mockResolvedValue({
      deletedCount: 2,
    } as never);
    db.collection("statePartyCandidates").updateMany.mockResolvedValue({
      modifiedCount: 3,
    } as never);
    db.collection("statePartyVotes").deleteMany.mockResolvedValue({
      deletedCount: 4,
    } as never);
    db.collection("nationalCommitteeCandidates").updateMany.mockResolvedValue({
      modifiedCount: 5,
    } as never);
    db.collection("nationalCommitteeVotes").deleteMany.mockResolvedValue({
      deletedCount: 6,
    } as never);
    db.collection("caucusChairCandidates").updateMany.mockResolvedValue({
      modifiedCount: 7,
    } as never);
    db.collection("caucusChairVotes").deleteMany.mockResolvedValue({
      deletedCount: 8,
    } as never);
    db.collection("caucuses").updateMany.mockResolvedValue({ modifiedCount: 0 } as never);

    const { cleanupPartyElectionsForBannedUser } =
      await import("./cleanupPartyElectionsForBannedUser");
    const result = await cleanupPartyElectionsForBannedUser(db as unknown as Db, userId);

    expect(result.characterIds).toEqual([charId.toString()]);
    expect(result.nationalPartyCandidatesWithdrawn).toBe(1);
    expect(result.nationalPartyVotesDeleted).toBe(2);
    expect(result.statePartyCandidatesWithdrawn).toBe(3);
    expect(result.statePartyVotesDeleted).toBe(4);
    expect(result.committeeCandidatesWithdrawn).toBe(5);
    expect(result.committeeVotesDeleted).toBe(6);
    expect(result.caucusChairCandidatesWithdrawn).toBe(7);
    expect(result.caucusChairVotesDeleted).toBe(8);

    // Candidates: only "active" rows are flipped, not previously withdrawn ones.
    expect(db.collection("nationalPartyCandidates").updateMany).toHaveBeenCalledWith(
      { characterId: { $in: [charId] }, status: "active" },
      { $set: { status: "withdrawn", withdrawnAt: expect.any(Date) } }
    );
    // Votes: any row by this voter is purged regardless of status.
    expect(db.collection("nationalPartyVotes").deleteMany).toHaveBeenCalledWith({
      voterId: { $in: [charId] },
    });
    expect(db.collection("statePartyVotes").deleteMany).toHaveBeenCalledWith({
      voterId: { $in: [charId] },
    });
    expect(db.collection("nationalCommitteeVotes").deleteMany).toHaveBeenCalledWith({
      voterId: { $in: [charId] },
    });
    expect(db.collection("caucusChairVotes").deleteMany).toHaveBeenCalledWith({
      $or: [{ voterId: { $in: [charId] } }, { candidateId: { $in: [charId] } }],
    });
  });

  it("targets all characters when a banned user owns multiple", async () => {
    const userId = new ObjectId();
    const charA = new ObjectId();
    const charB = new ObjectId();

    db.collection("characters").find.mockReturnValue({
      project: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([{ _id: charA }, { _id: charB }]),
    });

    const { cleanupPartyElectionsForBannedUser } =
      await import("./cleanupPartyElectionsForBannedUser");
    const result = await cleanupPartyElectionsForBannedUser(db as unknown as Db, userId);

    expect(result.characterIds).toEqual([charA.toString(), charB.toString()]);
    expect(result.caucusChairVotesDeleted).toBe(0);
    expect(db.collection("statePartyVotes").deleteMany).toHaveBeenCalledWith({
      voterId: { $in: [charA, charB] },
    });
    expect(db.collection("caucusChairVotes").deleteMany).toHaveBeenCalledWith({
      $or: [{ voterId: { $in: [charA, charB] } }, { candidateId: { $in: [charA, charB] } }],
    });
  });
});
