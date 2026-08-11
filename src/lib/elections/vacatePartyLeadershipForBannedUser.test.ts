import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

describe("vacatePartyLeadershipForBannedUser", () => {
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

    const { vacatePartyLeadershipForBannedUser } =
      await import("./vacatePartyLeadershipForBannedUser");
    const result = await vacatePartyLeadershipForBannedUser(db as unknown as Db, new ObjectId());

    expect(result.characterIds).toEqual([]);
    expect(result.nationalChairsVacated).toBe(0);
    expect(result.committeeSeatsVacated).toBe(0);
    expect(result.coalitionChairsCleared).toBe(0);
    // No reads of leadership collections — the helper short-circuits.
    expect(db.collection("politicalParties").find).not.toHaveBeenCalled();
    expect(db.collection("statePartyOrg").find).not.toHaveBeenCalled();
  });

  it("vacates national chair, viceChair, treasurer, and committee seat in one update", async () => {
    const userId = new ObjectId();
    const charId = new ObjectId();
    const partyOid = new ObjectId();
    const otherCommitteeId = new ObjectId();

    db.collection("characters").find.mockReturnValue({
      project: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([{ _id: charId }]),
    });

    // Single party where this character holds every position simultaneously.
    db.collection("politicalParties").find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        {
          _id: partyOid,
          chairId: charId,
          viceChairId: charId,
          treasurerId: charId,
          committeeIds: [charId, otherCommitteeId],
        },
      ]),
    });
    db.collection("statePartyOrg").find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });
    db.collection("coalitions").updateMany.mockResolvedValue({ modifiedCount: 0 } as never);

    const { vacatePartyLeadershipForBannedUser } =
      await import("./vacatePartyLeadershipForBannedUser");
    const result = await vacatePartyLeadershipForBannedUser(db as unknown as Db, userId);

    expect(result.nationalChairsVacated).toBe(1);
    expect(result.nationalViceChairsVacated).toBe(1);
    expect(result.nationalTreasurersVacated).toBe(1);
    expect(result.committeeSeatsVacated).toBe(1);

    // One party update with both $set and $pull operators.
    expect(db.collection("politicalParties").updateOne).toHaveBeenCalledTimes(1);
    const updateCall = db.collection("politicalParties").updateOne.mock.calls[0];
    expect(updateCall[0]).toEqual({ _id: partyOid });
    const updateOp = updateCall[1] as { $set?: Record<string, unknown>; $pull?: unknown };
    expect(updateOp.$set).toMatchObject({
      chairId: null,
      viceChairId: null,
      treasurerId: null,
    });
    expect(updateOp.$pull).toEqual({ committeeIds: { $in: [charId] } });
  });

  it("cascades chair clearance to coalitions led by the affected party", async () => {
    const userId = new ObjectId();
    const charId = new ObjectId();
    const partyOid = new ObjectId();

    db.collection("characters").find.mockReturnValue({
      project: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([{ _id: charId }]),
    });
    db.collection("politicalParties").find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        {
          _id: partyOid,
          chairId: charId,
          viceChairId: null,
          treasurerId: null,
          committeeIds: [],
        },
      ]),
    });
    db.collection("statePartyOrg").find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });
    db.collection("coalitions")
      .updateMany.mockResolvedValueOnce({ modifiedCount: 1 } as never) // direct chair hold
      .mockResolvedValueOnce({ modifiedCount: 2 } as never); // cascade by chairPartyId

    const { vacatePartyLeadershipForBannedUser } =
      await import("./vacatePartyLeadershipForBannedUser");
    const result = await vacatePartyLeadershipForBannedUser(db as unknown as Db, userId);

    expect(result.nationalChairsVacated).toBe(1);
    expect(result.coalitionChairsCleared).toBe(3);

    // Direct hold then cascade.
    expect(db.collection("coalitions").updateMany).toHaveBeenCalledTimes(2);
    expect(db.collection("coalitions").updateMany).toHaveBeenNthCalledWith(
      1,
      { chairCharacterId: { $in: [charId] } },
      { $set: { chairCharacterId: null, updatedAt: expect.any(Date) } }
    );
    expect(db.collection("coalitions").updateMany).toHaveBeenNthCalledWith(
      2,
      { chairPartyId: { $in: [partyOid] } },
      { $set: { chairCharacterId: null, updatedAt: expect.any(Date) } }
    );
  });

  it("vacates state-party seats independently of national-party seats", async () => {
    const userId = new ObjectId();
    const charId = new ObjectId();

    db.collection("characters").find.mockReturnValue({
      project: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([{ _id: charId }]),
    });
    db.collection("politicalParties").find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });
    db.collection("statePartyOrg").find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        { _id: "CA_1", chairId: charId, viceChairId: null, treasurerId: null },
        { _id: "TX_1", chairId: null, viceChairId: charId, treasurerId: null },
        { _id: "NY_1", chairId: null, viceChairId: null, treasurerId: charId },
      ]),
    });
    db.collection("coalitions").updateMany.mockResolvedValue({ modifiedCount: 0 } as never);

    const { vacatePartyLeadershipForBannedUser } =
      await import("./vacatePartyLeadershipForBannedUser");
    const result = await vacatePartyLeadershipForBannedUser(db as unknown as Db, userId);

    expect(result.stateChairsVacated).toBe(1);
    expect(result.stateViceChairsVacated).toBe(1);
    expect(result.stateTreasurersVacated).toBe(1);
    expect(db.collection("statePartyOrg").updateOne).toHaveBeenCalledTimes(3);
  });

  it("does not touch parties where seated character belongs to a different user", async () => {
    const userId = new ObjectId();
    const bannedCharId = new ObjectId();
    const otherCharId = new ObjectId();

    db.collection("characters").find.mockReturnValue({
      project: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([{ _id: bannedCharId }]),
    });
    db.collection("politicalParties").find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        // The Mongo $or query in production wouldn't match this, but if a stale
        // doc slipped through the JS guard must still skip it.
        {
          _id: new ObjectId(),
          chairId: otherCharId,
          viceChairId: null,
          treasurerId: null,
          committeeIds: [otherCharId],
        },
      ]),
    });
    db.collection("statePartyOrg").find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });
    db.collection("coalitions").updateMany.mockResolvedValue({ modifiedCount: 0 } as never);

    const { vacatePartyLeadershipForBannedUser } =
      await import("./vacatePartyLeadershipForBannedUser");
    const result = await vacatePartyLeadershipForBannedUser(db as unknown as Db, userId);

    expect(result.nationalChairsVacated).toBe(0);
    expect(result.committeeSeatsVacated).toBe(0);
    expect(db.collection("politicalParties").updateOne).not.toHaveBeenCalled();
  });
});
