import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/utils/electionCandidacy", () => ({
  withdrawFromMismatchedPrimaries: vi.fn().mockResolvedValue({ withdrawnCount: 0, elections: [] }),
  cleanupPartyPositionsOnSwitch: vi.fn().mockResolvedValue({
    clearedNationalLeadership: [],
    clearedStateLeadership: [],
    removedFromCommittee: false,
    withdrawnStateElections: 0,
    withdrawnNationalElections: 0,
    withdrawnCommitteeElections: 0,
  }),
}));

vi.mock("@/lib/turn/partyOrg/presence", () => ({
  updatePartyPresence: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/db/partyLookup", () => ({
  findPartyBySequentialId: vi.fn().mockResolvedValue({
    _id: new ObjectId(),
    sequentialId: 3,
    chairId: null,
  }),
}));

describe("stripPartyMembershipForBannedUser", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
  });

  it("sets characters to independent and decrements party member count", async () => {
    const userId = new ObjectId();
    const charId = new ObjectId();

    db.collection("characters").find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        {
          _id: charId,
          userId,
          party: "3",
          countryId: "UK",
          homeState: "NEE",
        },
      ]),
    });

    db.collection("characters").updateOne.mockResolvedValue({ modifiedCount: 1 } as never);
    db.collection("characters").updateMany.mockResolvedValue({ modifiedCount: 1 } as never);
    db.collection("electedOfficials").updateMany.mockResolvedValue({ modifiedCount: 0 } as never);
    db.collection("politicalParties").updateOne.mockResolvedValue({ modifiedCount: 1 } as never);
    db.collection("caucusMemberships").find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        {
          _id: new ObjectId(),
          caucusId: new ObjectId(),
          memberType: "character",
          memberId: charId,
          status: "active",
        },
      ]),
    });
    db.collection("caucusMemberships").updateMany.mockResolvedValue({ modifiedCount: 1 } as never);
    db.collection("caucusChairCandidates").updateMany.mockResolvedValue({
      modifiedCount: 0,
    } as never);
    db.collection("caucusChairVotes").deleteMany.mockResolvedValue({ deletedCount: 0 } as never);
    db.collection("caucuses").updateMany.mockResolvedValue({ modifiedCount: 0 } as never);

    const { stripPartyMembershipForBannedUser } =
      await import("./stripPartyMembershipForBannedUser");
    const result = await stripPartyMembershipForBannedUser(db as unknown as Db, userId);

    expect(result.charactersUpdated).toBe(1);
    expect(db.collection("characters").updateOne).toHaveBeenCalledWith(
      { _id: charId },
      expect.objectContaining({
        $set: expect.objectContaining({
          party: "independent",
          partyInfluence: 0,
        }),
      })
    );
    expect(db.collection("politicalParties").updateOne).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        $inc: { memberCount: -1 },
      })
    );
    expect(db.collection("caucusMemberships").updateMany).toHaveBeenCalledWith(
      { _id: { $in: [expect.any(Object)] } },
      expect.objectContaining({
        $set: expect.objectContaining({ status: "removed" }),
      })
    );
  });

  it("cascades to charters: rejects pending signatures from the banned user's characters (F-N)", async () => {
    const userId = new ObjectId();
    const charId1 = new ObjectId();
    const charId2 = new ObjectId();

    // Banned user owns two characters (multi-persona play).
    db.collection("characters").find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        { _id: charId1, userId, party: "independent" },
        { _id: charId2, userId, party: "independent" },
      ]),
    });
    db.collection("partyCharters").updateMany.mockResolvedValue({
      modifiedCount: 1,
    } as never);

    const { stripPartyMembershipForBannedUser } =
      await import("./stripPartyMembershipForBannedUser");
    await stripPartyMembershipForBannedUser(db as unknown as Db, userId);

    // One updateMany call per banned character — the cascade cycles
    // through every character so multi-character users with multiple
    // founder slots all get cleaned up.
    expect(db.collection("partyCharters").updateMany).toHaveBeenCalledTimes(2);
    expect(db.collection("partyCharters").updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "pending-signatures",
        "signatures.characterId": charId1,
      }),
      expect.objectContaining({
        $set: expect.objectContaining({
          status: "founder-replacement",
          "signatures.$.rejectionReason": "Founder account banned",
        }),
      })
    );
    expect(db.collection("partyCharters").updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "pending-signatures",
        "signatures.characterId": charId2,
      }),
      expect.any(Object)
    );
  });

  it("returns 0 when user has no party-affiliated characters", async () => {
    db.collection("characters").find.mockReturnValue({
      toArray: vi
        .fn()
        .mockResolvedValue([{ _id: new ObjectId(), userId: new ObjectId(), party: "independent" }]),
    });

    const { stripPartyMembershipForBannedUser } =
      await import("./stripPartyMembershipForBannedUser");
    const result = await stripPartyMembershipForBannedUser(db as unknown as Db, new ObjectId());

    expect(result.charactersUpdated).toBe(0);
    expect(db.collection("characters").updateOne).not.toHaveBeenCalled();
  });
});
