import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import type { CorporationVote, CorporationPrivatizationVote } from "@/lib/db/types";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { processVoteReminders } from "./voteReminders";

const { notifyVoteEventRawMock, proposalSummaryMock } = vi.hoisted(() => ({
  notifyVoteEventRawMock: vi.fn(),
  proposalSummaryMock: vi.fn(() => "vote proposal"),
}));

vi.mock("@/lib/corporations/votes/voteNotifications", () => ({
  notifyVoteEvent: vi.fn(),
  notifyVoteEventRaw: notifyVoteEventRawMock,
  proposalSummary: proposalSummaryMock,
}));
vi.mock("@/lib/corporations/votes/voteService", () => ({
  resolveCorporationVoteIfReady: vi.fn(),
}));
vi.mock("@/lib/corporations/superShares", () => ({ totalVotingPower: vi.fn() }));
vi.mock("@/lib/corporations/votes/voteEffects", () => ({ applyPassedVoteEffects: vi.fn() }));
vi.mock("@/lib/corporations/commands/privatization/resolvePrivatizationVote", () => ({
  resolvePrivatizationVote: vi.fn(),
}));

describe("processVoteReminders", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("corporationVotes");
    db.collection("corporationPrivatizationVotes");
    db.collection("corporations");
    db.collection("characters");
  });

  it("loads corporations and unvoted shareholder accounts in batches", async () => {
    const corpA = new ObjectId();
    const corpB = new ObjectId();
    const charA = new ObjectId();
    const charB = new ObjectId();
    const charC = new ObjectId();
    const charD = new ObjectId();
    const userA = new ObjectId();
    const userB = new ObjectId();
    const userD = new ObjectId();
    const genericOne = {
      _id: new ObjectId(),
      corporationId: corpA,
      votes: [{ characterId: charA }],
    } as unknown as CorporationVote;
    const genericTwo = {
      _id: new ObjectId(),
      corporationId: corpA,
      votes: [],
    } as unknown as CorporationVote;
    const privatization = {
      _id: new ObjectId(),
      corporationId: corpB,
      votes: [{ characterId: charC }],
    } as unknown as CorporationPrivatizationVote;

    db.collectionMocks.corporationVotes.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([genericOne, genericTwo]),
    });
    db.collectionMocks.corporationPrivatizationVotes.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([privatization]),
    });
    db.collectionMocks.corporations.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        {
          _id: corpA,
          name: "Alpha Corp",
          shareholders: [
            { characterId: charA, shares: 1 },
            { characterId: charB, shares: 1 },
          ],
        },
        {
          _id: corpB,
          name: "Beta Corp",
          shareholders: [
            { characterId: charC, shares: 1 },
            { characterId: charD, shares: 1 },
          ],
        },
      ]),
    });
    db.collectionMocks.characters.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        { _id: charA, userId: userA },
        { _id: charB, userId: userB },
        { _id: charD, userId: userD },
      ]),
    });

    await processVoteReminders(db as unknown as Db, 100);

    expect(db.collectionMocks.corporations.findOne).not.toHaveBeenCalled();
    expect(db.collectionMocks.corporations.find).toHaveBeenCalledTimes(1);
    expect(db.collectionMocks.corporations.find).toHaveBeenCalledWith(
      { _id: { $in: [corpA, corpB] } },
      { projection: { name: 1, shareholders: 1 } }
    );
    expect(db.collectionMocks.characters.find).toHaveBeenCalledTimes(1);
    expect(db.collectionMocks.characters.find).toHaveBeenCalledWith(
      { _id: { $in: [charB, charA, charD] } },
      { projection: { userId: 1 } }
    );
    expect(notifyVoteEventRawMock).toHaveBeenCalledTimes(3);

    const usersByVoteId = new Map(
      notifyVoteEventRawMock.mock.calls.map(([input]) => [
        input.voteId.toString(),
        input.userIds.map((id: ObjectId) => id.toString()),
      ])
    );
    expect(usersByVoteId.get(genericOne._id.toString())).toEqual([userB.toString()]);
    expect(usersByVoteId.get(genericTwo._id.toString())).toEqual([
      userA.toString(),
      userB.toString(),
    ]);
    expect(usersByVoteId.get(privatization._id.toString())).toEqual([userD.toString()]);
  });
});
