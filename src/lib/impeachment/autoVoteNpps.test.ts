import { describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import type { Impeachment } from "@/lib/db/types/impeachment";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { autoVoteNppsForImpeachmentStage } from "./autoVoteNpps";
import { processImpeachmentLifecycle } from "@/lib/turn/impeachmentLifecycle";

describe("autoVoteNppsForImpeachmentStage", () => {
  it("casts government NPP blocs against impeachment and opposition blocs for it", async () => {
    const db = createMockDb();
    const impeachmentId = new ObjectId();
    const presidentId = new ObjectId();
    const governmentNppId = new ObjectId();
    const oppositionNppId = new ObjectId();
    const impeachment = {
      _id: impeachmentId,
      countryId: "US",
      targetCharacterId: presidentId,
      targetOffice: "president",
      stage: "house",
      houseVotes: {},
    } as Impeachment;

    db.collectionMocks.electedOfficials = {
      ...db.collection("electedOfficials"),
      findOne: vi.fn().mockResolvedValue({ characterId: presidentId, party: "1" }),
      find: vi.fn().mockReturnValue({
        project: vi.fn().mockReturnThis(),
        toArray: vi.fn().mockResolvedValue([
          {
            countryId: "US",
            officeType: "house",
            isNPP: true,
            nppId: governmentNppId,
            party: "1",
            seatsHeld: 300,
          },
          {
            countryId: "US",
            officeType: "house",
            isNPP: true,
            nppId: oppositionNppId,
            party: "2",
            seatsHeld: 133,
          },
        ]),
      }),
    } as MockDb["collectionMocks"][string];
    db.collectionMocks.billWhips = {
      ...db.collection("billWhips"),
      find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
    } as MockDb["collectionMocks"][string];
    db.collectionMocks.impeachments = {
      ...db.collection("impeachments"),
      updateOne: vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
    } as MockDb["collectionMocks"][string];

    await autoVoteNppsForImpeachmentStage(db as unknown as Db, impeachment);

    expect(db.collectionMocks.impeachments.updateOne).toHaveBeenCalledWith(
      {
        _id: impeachmentId,
        stage: "house",
        [`houseVotes.npp_${governmentNppId.toString()}`]: { $exists: false },
      },
      {
        $set: {
          [`houseVotes.npp_${governmentNppId.toString()}`]: "nay",
          updatedAt: expect.any(Date),
        },
        $inc: { houseVotesAgainst: 300 },
      }
    );
    expect(db.collectionMocks.impeachments.updateOne).toHaveBeenCalledWith(
      {
        _id: impeachmentId,
        stage: "house",
        [`houseVotes.npp_${oppositionNppId.toString()}`]: { $exists: false },
      },
      {
        $set: {
          [`houseVotes.npp_${oppositionNppId.toString()}`]: "aye",
          updatedAt: expect.any(Date),
        },
        $inc: { houseVotesFor: 133 },
      }
    );
  });

  it("prevents a two-seat player vote from advancing over the NPP House majority", async () => {
    const db = createMockDb();
    const impeachmentId = new ObjectId();
    const presidentId = new ObjectId();
    const playerId = new ObjectId();
    const governmentNppId = new ObjectId();
    const oppositionNppId = new ObjectId();
    const impeachment = {
      _id: impeachmentId,
      countryId: "US",
      targetCharacterId: presidentId,
      targetName: "President",
      targetOffice: "president",
      stage: "house",
      houseVotesFor: 2,
      houseVotesAgainst: 0,
      houseVotesAbstain: 0,
      houseVotes: { [playerId.toString()]: "aye" },
      houseVotingEndsOnTurn: 10,
      senateVotesFor: 0,
      senateVotesAgainst: 0,
      senateVotesAbstain: 0,
      senateVotes: {},
      senateVotingEndsOnTurn: null,
      turnFiled: 4,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as Impeachment;
    const officials = [
      {
        countryId: "US",
        officeType: "house",
        characterId: playerId,
        seatsHeld: 2,
      },
      {
        countryId: "US",
        officeType: "house",
        isNPP: true,
        nppId: governmentNppId,
        party: "1",
        seatsHeld: 300,
      },
      {
        countryId: "US",
        officeType: "house",
        isNPP: true,
        nppId: oppositionNppId,
        party: "2",
        seatsHeld: 133,
      },
    ];

    db.collectionMocks.electedOfficials = {
      ...db.collection("electedOfficials"),
      findOne: vi.fn().mockResolvedValue({ characterId: presidentId, party: "1" }),
      find: vi.fn().mockReturnValue({
        project: vi.fn().mockReturnThis(),
        toArray: vi.fn().mockResolvedValue(officials),
      }),
    } as MockDb["collectionMocks"][string];
    db.collectionMocks.impeachments = {
      ...db.collection("impeachments"),
      find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([impeachment]) }),
      updateOne: vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
    } as MockDb["collectionMocks"][string];

    await processImpeachmentLifecycle(db as unknown as Db, 10, new Date());

    expect(db.collectionMocks.impeachments.updateOne).toHaveBeenCalledWith(
      { _id: impeachmentId, stage: "house" },
      { $set: expect.objectContaining({ stage: "dismissed", resolvedOnTurn: 10 }) }
    );
    expect(db.collectionMocks.impeachments.updateOne).not.toHaveBeenCalledWith(
      { _id: impeachmentId, stage: "house" },
      { $set: expect.objectContaining({ stage: "senate" }) }
    );
  });
});
