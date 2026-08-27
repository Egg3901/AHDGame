import { describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import type { Impeachment } from "@/lib/db/types/impeachment";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { autoVoteNppsForImpeachmentStage } from "./autoVoteNpps";
import { processImpeachmentLifecycle } from "@/lib/turn/impeachmentLifecycle";

function mockImpeachmentDb(
  db: MockDb,
  opts: {
    targetParty: string | undefined;
    officials: unknown[];
    npps?: unknown[];
    targetStance?: { economic: number; social: number };
    parties?: Array<{ sequentialId: number; tier?: string; isDefault?: boolean }>;
  }
) {
  db.collectionMocks.electedOfficials = {
    ...db.collection("electedOfficials"),
    findOne: vi
      .fn()
      .mockResolvedValue(
        opts.targetParty == null
          ? { characterId: new ObjectId(), party: null }
          : { characterId: new ObjectId(), party: opts.targetParty }
      ),
    find: vi.fn().mockReturnValue({
      project: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue(opts.officials),
    }),
  } as MockDb["collectionMocks"][string];
  db.collectionMocks.npps = {
    ...db.collection("npps"),
    find: vi.fn().mockReturnValue({
      project: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue(opts.npps ?? []),
    }),
  } as MockDb["collectionMocks"][string];
  db.collectionMocks.characters = {
    ...db.collection("characters"),
    findOne: vi.fn().mockResolvedValue(opts.targetStance ? { policies: opts.targetStance } : null),
  } as MockDb["collectionMocks"][string];
  db.collectionMocks.politicalParties = {
    ...db.collection("politicalParties"),
    find: vi.fn().mockReturnValue({
      project: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue(opts.parties ?? []),
    }),
  } as MockDb["collectionMocks"][string];
  db.collectionMocks.impeachments = {
    ...db.collection("impeachments"),
    updateOne: vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
  } as MockDb["collectionMocks"][string];
}

function houseImpeachment(overrides: Partial<Impeachment> = {}): Impeachment {
  return {
    _id: new ObjectId(),
    countryId: "US",
    targetCharacterId: new ObjectId(),
    targetOffice: "president",
    stage: "house",
    houseVotes: {},
    ...overrides,
  } as Impeachment;
}

describe("autoVoteNppsForImpeachmentStage", () => {
  it("casts government NPP blocs against impeachment and far opposition blocs for it", async () => {
    const db = createMockDb();
    const impeachmentId = new ObjectId();
    const governmentNppId = new ObjectId();
    const oppositionNppId = new ObjectId();
    const impeachment = houseImpeachment({
      _id: impeachmentId,
      targetCharacterId: new ObjectId(),
    });

    mockImpeachmentDb(db, {
      targetParty: "1",
      targetStance: { economic: 2, social: 2 },
      parties: [
        { sequentialId: 1, tier: "major", isDefault: true },
        { sequentialId: 2, tier: "major", isDefault: true },
      ],
      npps: [
        { _id: governmentNppId, policies: { economic: 2, social: 2 } },
        { _id: oppositionNppId, policies: { economic: -2, social: -2 } },
      ],
      officials: [
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
      ],
    });

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

  it("does NOT auto-aye an opposition bloc ideologically near the target", async () => {
    const db = createMockDb();
    const nearNppId = new ObjectId();
    const impeachment = houseImpeachment();

    mockImpeachmentDb(db, {
      targetParty: "1",
      targetStance: { economic: 2, social: 2 },
      parties: [
        { sequentialId: 1, tier: "major", isDefault: true },
        { sequentialId: 2, tier: "major", isDefault: true },
      ],
      npps: [{ _id: nearNppId, policies: { economic: 1, social: 2 } }],
      officials: [
        {
          countryId: "US",
          officeType: "house",
          isNPP: true,
          nppId: nearNppId,
          party: "2",
          seatsHeld: 12,
        },
      ],
    });

    // rng always high: the uncertain close vote lands on abstain, never aye.
    await autoVoteNppsForImpeachmentStage(db as unknown as Db, impeachment, () => 0.9);

    expect(db.collectionMocks.impeachments.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ _id: impeachment._id }),
      expect.objectContaining({
        $set: expect.objectContaining({
          [`houseVotes.npp_${nearNppId.toString()}`]: "abstain",
        }),
        $inc: { houseVotesAbstain: 12 },
      })
    );
    expect(db.collectionMocks.impeachments.updateOne).not.toHaveBeenCalledWith(
      expect.objectContaining({ _id: impeachment._id }),
      expect.objectContaining({
        $set: expect.objectContaining({
          [`houseVotes.npp_${nearNppId.toString()}`]: "aye",
        }),
      })
    );
  });

  it("makes ideologically-close opposition votes deterministic via the injected rng", async () => {
    const closeNppId = new ObjectId();
    const buildDb = () => {
      const db = createMockDb();
      mockImpeachmentDb(db, {
        targetParty: "1",
        targetStance: { economic: 0, social: 0 },
        parties: [
          { sequentialId: 1, tier: "major", isDefault: true },
          { sequentialId: 2, tier: "major", isDefault: true },
        ],
        npps: [{ _id: closeNppId, policies: { economic: 1, social: -1 } }],
        officials: [
          {
            countryId: "US",
            officeType: "house",
            isNPP: true,
            nppId: closeNppId,
            party: "2",
            seatsHeld: 5,
          },
        ],
      });
      return db;
    };
    const nppKey = `houseVotes.npp_${closeNppId.toString()}`;

    const ayeDb = buildDb();
    await autoVoteNppsForImpeachmentStage(ayeDb as unknown as Db, houseImpeachment(), () => 0.4);
    expect(ayeDb.collectionMocks.impeachments.updateOne.mock.calls[0][1].$set).toMatchObject({
      [nppKey]: "aye",
    });

    const abstainDb = buildDb();
    await autoVoteNppsForImpeachmentStage(
      abstainDb as unknown as Db,
      houseImpeachment(),
      () => 0.6
    );
    expect(abstainDb.collectionMocks.impeachments.updateOne.mock.calls[0][1].$set).toMatchObject({
      [nppKey]: "abstain",
    });
  });

  it("abstains minor-party blocs without a clear ideological signal", async () => {
    const db = createMockDb();
    const minorNppId = new ObjectId();
    const impeachment = houseImpeachment();

    mockImpeachmentDb(db, {
      targetParty: "1",
      parties: [{ sequentialId: 1, tier: "major", isDefault: true }],
      officials: [
        {
          countryId: "US",
          officeType: "house",
          isNPP: true,
          nppId: minorNppId,
          party: "7",
          seatsHeld: 3,
        },
      ],
    });

    await autoVoteNppsForImpeachmentStage(db as unknown as Db, impeachment, () => 0.1);

    expect(db.collectionMocks.impeachments.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ _id: impeachment._id }),
      expect.objectContaining({
        $set: expect.objectContaining({
          [`houseVotes.npp_${minorNppId.toString()}`]: "abstain",
        }),
      })
    );
  });

  it("abstains partyless blocs", async () => {
    const db = createMockDb();
    const independentNppId = new ObjectId();
    const impeachment = houseImpeachment();

    mockImpeachmentDb(db, {
      targetParty: "1",
      officials: [
        {
          countryId: "US",
          officeType: "house",
          isNPP: true,
          nppId: independentNppId,
          party: null,
          seatsHeld: 4,
        },
      ],
    });

    await autoVoteNppsForImpeachmentStage(db as unknown as Db, impeachment);

    expect(db.collectionMocks.impeachments.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ _id: impeachment._id }),
      expect.objectContaining({
        $set: expect.objectContaining({
          [`houseVotes.npp_${independentNppId.toString()}`]: "abstain",
        }),
        $inc: { houseVotesAbstain: 4 },
      })
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

  it("does NOT impeach on a 2-0 House vote in a full 435-seat chamber (ticket #1173)", async () => {
    const db = createMockDb();
    const presidentId = new ObjectId();
    const playerA = new ObjectId();
    const playerB = new ObjectId();
    const unalignedBlocA = new ObjectId();
    const unalignedBlocB = new ObjectId();
    // Two player ayes are the only votes cast; the rest of the chamber is
    // partyless blocs that abstain. Prod doc 6a8a6054849ffcd37a89786b passed
    // the House 2-0 under the old votes-cast bar; against all 435 seats it
    // must be dismissed.
    const impeachment = {
      _id: new ObjectId(),
      countryId: "US",
      targetCharacterId: presidentId,
      targetName: "President",
      targetOffice: "president",
      stage: "house",
      houseVotesFor: 2,
      houseVotesAgainst: 0,
      houseVotesAbstain: 0,
      houseVotes: { [playerA.toString()]: "aye", [playerB.toString()]: "aye" },
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

    db.collectionMocks.electedOfficials = {
      ...db.collection("electedOfficials"),
      findOne: vi.fn().mockResolvedValue({ characterId: presidentId, party: null }),
      find: vi.fn().mockReturnValue({
        project: vi.fn().mockReturnThis(),
        toArray: vi.fn().mockResolvedValue([
          { countryId: "US", officeType: "house", characterId: playerA, seatsHeld: 1 },
          { countryId: "US", officeType: "house", characterId: playerB, seatsHeld: 1 },
          {
            countryId: "US",
            officeType: "house",
            isNPP: true,
            nppId: unalignedBlocA,
            seatsHeld: 216,
          },
          {
            countryId: "US",
            officeType: "house",
            isNPP: true,
            nppId: unalignedBlocB,
            seatsHeld: 217,
          },
        ]),
      }),
    } as MockDb["collectionMocks"][string];
    db.collectionMocks.impeachments = {
      ...db.collection("impeachments"),
      find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([impeachment]) }),
      updateOne: vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
    } as MockDb["collectionMocks"][string];

    await processImpeachmentLifecycle(db as unknown as Db, 10, new Date());

    expect(db.collectionMocks.impeachments.updateOne).toHaveBeenCalledWith(
      { _id: impeachment._id, stage: "house" },
      { $set: expect.objectContaining({ stage: "dismissed", resolvedOnTurn: 10 }) }
    );
    expect(db.collectionMocks.impeachments.updateOne).not.toHaveBeenCalledWith(
      { _id: impeachment._id, stage: "house" },
      { $set: expect.objectContaining({ stage: "senate" }) }
    );
  });

  it("does NOT convict at a 0-0-0 Senate stage (ticket #1173)", async () => {
    const db = createMockDb();
    const presidentId = new ObjectId();
    const impeachment = {
      _id: new ObjectId(),
      countryId: "US",
      targetCharacterId: presidentId,
      targetName: "President",
      targetOffice: "president",
      stage: "senate",
      houseVotesFor: 39,
      houseVotesAgainst: 0,
      houseVotesAbstain: 0,
      houseVotes: {},
      houseVotingEndsOnTurn: 4,
      senateVotesFor: 0,
      senateVotesAgainst: 0,
      senateVotesAbstain: 0,
      senateVotes: {},
      senateVotingEndsOnTurn: 10,
      turnFiled: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as Impeachment;

    db.collectionMocks.electedOfficials = {
      ...db.collection("electedOfficials"),
      findOne: vi.fn().mockResolvedValue({ characterId: presidentId, party: null }),
      find: vi.fn().mockReturnValue({
        project: vi.fn().mockReturnThis(),
        toArray: vi.fn().mockResolvedValue([
          {
            countryId: "US",
            officeType: "senate",
            isNPP: true,
            nppId: new ObjectId(),
            seatsHeld: 100,
          },
        ]),
      }),
    } as MockDb["collectionMocks"][string];
    db.collectionMocks.impeachments = {
      ...db.collection("impeachments"),
      find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([impeachment]) }),
      updateOne: vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
    } as MockDb["collectionMocks"][string];

    await processImpeachmentLifecycle(db as unknown as Db, 10, new Date());

    // Prod doc 6a80c184f6e762f349e0718e was acquitted on zero votes cast; the
    // new bar fails it deliberately (abstain weighs against conviction).
    expect(db.collectionMocks.impeachments.updateOne).toHaveBeenCalledWith(
      { _id: impeachment._id, stage: "senate" },
      { $set: expect.objectContaining({ stage: "acquitted", resolvedOnTurn: 10 }) }
    );
    expect(db.collectionMocks.impeachments.updateOne).not.toHaveBeenCalledWith(
      { _id: impeachment._id, stage: "senate" },
      { $set: expect.objectContaining({ stage: "convicted" }) }
    );
  });
});
