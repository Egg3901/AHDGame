import { describe, it, expect, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import {
  applyPlayerWhipToBill,
  applyPlayerWhipToLeadership,
  applyPlayerWhipToGovernmentVote,
  applyPlayerWhipToCabinet,
} from "./applyPlayerWhip";
import type { Bill, SpeakerNomination } from "@/lib/db/types";

// Mock the governmentFormation collection getters to route calls to the MockDb's
// pmAppointmentVotes / noConfidenceVotes collections, so we can assert on them.

const makeBill = (overrides: Partial<Bill> = {}): Bill =>
  ({
    _id: new ObjectId(),
    status: "active",
    votes: {},
    votesFor: 0,
    votesAgainst: 0,
    votesAbstain: 0,
    ...overrides,
  }) as unknown as Bill;

describe("applyPlayerWhipToBill", () => {
  let db: MockDb;

  beforeEach(() => {
    db = createMockDb();
  });

  it("overwrites votes[characterId] to direction and snapshots prior value", async () => {
    const c1 = new ObjectId();
    const c2 = new ObjectId();
    const bill = makeBill({
      votes: { [c1.toString()]: "against" },
      votesAgainst: 1,
    });

    const result = await applyPlayerWhipToBill(db as unknown as Db, bill, "for", [c1, c2]);

    expect(result).toEqual({ overridden: 2, alreadyAligned: 0 });

    const billsMock = db.collectionMocks["bills"];
    const updateCalls = billsMock!.updateOne.mock.calls;
    expect(updateCalls).toHaveLength(1);
    const [, update] = updateCalls[0];
    expect(update.$set[`votes.${c1.toString()}`]).toBe("for");
    expect(update.$set[`votes.${c2.toString()}`]).toBe("for");
    expect(update.$set[`whippedFromVote.${c1.toString()}`]).toBe("against");
    expect(update.$set[`whippedFromVote.${c2.toString()}`]).toBe("unvoted");
  });

  it("updates bill tallies using the character's seat weight", async () => {
    const c1 = new ObjectId();
    const c2 = new ObjectId();
    const bill = makeBill({
      votes: { [c1.toString()]: "against" },
      votesAgainst: 3,
    });

    db.collection("electedOfficials").find.mockReturnValueOnce({
      toArray: async () => [
        { characterId: c1, seatsHeld: 3 },
        { characterId: c2, seatsHeld: 2 },
      ],
    });

    await applyPlayerWhipToBill(db as unknown as Db, bill, "for", [c1, c2]);

    const [, update] = db.collectionMocks["bills"]!.updateOne.mock.calls[0];
    expect(update.$inc).toEqual({
      votesFor: 5,
      votesAgainst: -3,
    });
  });

  it("counts alreadyAligned when character already voted the whip direction (and still writes snapshot)", async () => {
    const c1 = new ObjectId();
    const bill = makeBill({
      votes: { [c1.toString()]: "for" },
      votesFor: 1,
    });

    const result = await applyPlayerWhipToBill(db as unknown as Db, bill, "for", [c1]);

    expect(result).toEqual({ overridden: 0, alreadyAligned: 1 });
    const billsMock = db.collectionMocks["bills"];
    const [, update] = billsMock!.updateOne.mock.calls[0];
    expect(update.$set[`whippedFromVote.${c1.toString()}`]).toBe("for");
  });

  it("writes otherChamberVotes / otherChamberWhippedFromVote when bill.status is active_other", async () => {
    const c1 = new ObjectId();
    const bill = makeBill({
      status: "active_other",
      votes: {},
      otherChamberVotes: {},
    });

    await applyPlayerWhipToBill(db as unknown as Db, bill, "against", [c1]);

    const billsMock = db.collectionMocks["bills"];
    const [, update] = billsMock!.updateOne.mock.calls[0];
    expect(update.$set[`otherChamberVotes.${c1.toString()}`]).toBe("against");
    expect(update.$set[`otherChamberWhippedFromVote.${c1.toString()}`]).toBe("unvoted");
  });

  it("no-ops when eligibleCharacterIds is empty", async () => {
    const bill = makeBill();
    const result = await applyPlayerWhipToBill(db as unknown as Db, bill, "for", []);
    expect(result).toEqual({ overridden: 0, alreadyAligned: 0 });
    const billsMock = db.collectionMocks["bills"];
    // bills collection was never accessed
    expect(billsMock).toBeUndefined();
  });
});

describe("applyPlayerWhipToLeadership", () => {
  let db: MockDb;

  beforeEach(() => {
    db = createMockDb();
  });

  it("casts votes for target candidate and snapshots prior candidate (or 'unvoted')", async () => {
    const targetId = new ObjectId();
    const otherId = new ObjectId();
    const c1 = new ObjectId();
    const c2 = new ObjectId();

    const nominations = [
      { _id: targetId, votes: {}, votesFor: 0, status: "voting" },
      { _id: otherId, votes: { [c1.toString()]: "for" }, votesFor: 1, status: "voting" },
    ] as unknown as SpeakerNomination[];

    db.collection("speakerNominations").find.mockReturnValueOnce({
      toArray: async () => nominations,
    });
    db.collection("electedOfficials").find.mockReturnValueOnce({
      toArray: async () => [
        { characterId: c1, seatsHeld: 1 },
        { characterId: c2, seatsHeld: 1 },
      ],
    });

    const result = await applyPlayerWhipToLeadership(
      db as unknown as Db,
      targetId,
      "speakerNominations",
      [c1, c2]
    );

    expect(result.overridden).toBe(2);

    const updateCalls = db.collectionMocks["speakerNominations"]!.updateOne.mock.calls;
    // One update to the previous nomination (removing c1's vote), one to the target
    const targetUpdate = updateCalls.find(
      (c) => (c[0] as { _id: ObjectId })._id && (c[0] as { _id: ObjectId })._id.equals(targetId)
    );
    const previousUpdate = updateCalls.find(
      (c) => (c[0] as { _id: ObjectId })._id && (c[0] as { _id: ObjectId })._id.equals(otherId)
    );
    expect(targetUpdate).toBeDefined();
    expect(previousUpdate).toBeDefined();
    expect((previousUpdate![1] as { $unset: Record<string, string> }).$unset).toEqual({
      [`votes.${c1.toString()}`]: "",
      [`whippedFromVote.${c1.toString()}`]: "",
    });
    const targetSet = (targetUpdate![1] as { $set: Record<string, unknown> }).$set;
    expect(targetSet[`votes.${c1.toString()}`]).toBe("for");
    expect(targetSet[`votes.${c2.toString()}`]).toBe("for");
    expect(targetSet[`whippedFromVote.${c1.toString()}`]).toBe(otherId.toString());
    expect(targetSet[`whippedFromVote.${c2.toString()}`]).toBe("unvoted");
  });

  it("increments votesFor by seatsHeld when whipping multi-seat members (ticket #1053)", async () => {
    const targetId = new ObjectId();
    const c1 = new ObjectId();
    const c2 = new ObjectId();

    db.collection("speakerNominations").find.mockReturnValueOnce({
      toArray: async () => [{ _id: targetId, votes: {}, votesFor: 0, status: "voting" }],
    });
    db.collection("electedOfficials").find.mockReturnValueOnce({
      toArray: async () => [
        { characterId: c1, seatsHeld: 7 },
        { characterId: c2, seatsHeld: 3 },
      ],
    });

    await applyPlayerWhipToLeadership(db as unknown as Db, targetId, "speakerNominations", [
      c1,
      c2,
    ]);

    const targetUpdate = db.collectionMocks["speakerNominations"]!.updateOne.mock.calls.find((c) =>
      (c[0] as { _id: ObjectId })._id?.equals(targetId)
    );
    expect(targetUpdate).toBeDefined();
    expect((targetUpdate![1] as { $inc: { votesFor: number } }).$inc.votesFor).toBe(10);
  });

  it("does not steal votes from a different leadership role (ticket #1046)", async () => {
    const majorityWhipId = new ObjectId();
    const proTemporeId = new ObjectId();
    const charId = new ObjectId();
    const key = charId.toString();

    const nominations = [
      {
        _id: majorityWhipId,
        role: "majority_whip",
        votes: {},
        votesFor: 0,
        status: "voting",
      },
      {
        _id: proTemporeId,
        role: "pro_tempore",
        votes: { [key]: "for" },
        votesFor: 1,
        status: "voting",
        whippedFromVote: { [key]: "unvoted" },
      },
    ] as unknown as SpeakerNomination[];

    db.collection("senateLeadershipNominations").find.mockReturnValueOnce({
      toArray: async () => nominations,
    });
    db.collection("electedOfficials").find.mockReturnValueOnce({
      toArray: async () => [{ characterId: charId, seatsHeld: 1 }],
    });

    const result = await applyPlayerWhipToLeadership(
      db as unknown as Db,
      majorityWhipId,
      "senateLeadershipNominations",
      [charId]
    );

    expect(result.overridden).toBe(1);

    const updateCalls = db.collectionMocks["senateLeadershipNominations"]!.updateOne.mock.calls;
    const previousUpdate = updateCalls.find((c) =>
      (c[0] as { _id: ObjectId })._id?.equals(proTemporeId)
    );
    expect(previousUpdate).toBeUndefined();

    const targetUpdate = updateCalls.find((c) =>
      (c[0] as { _id: ObjectId })._id?.equals(majorityWhipId)
    );
    expect(targetUpdate).toBeDefined();
    const targetSet = (targetUpdate![1] as { $set: Record<string, unknown> }).$set;
    expect(targetSet[`votes.${key}`]).toBe("for");
    // Prior vote was on a different role — treat as unvoted within this race
    expect(targetSet[`whippedFromVote.${key}`]).toBe("unvoted");
  });

  it("counts alreadyAligned when character already votes for the target", async () => {
    const targetId = new ObjectId();
    const c1 = new ObjectId();

    const nominations = [
      { _id: targetId, votes: { [c1.toString()]: "for" }, votesFor: 1, status: "voting" },
    ] as unknown as SpeakerNomination[];

    db.collection("speakerNominations").find.mockReturnValueOnce({
      toArray: async () => nominations,
    });
    db.collection("electedOfficials").find.mockReturnValueOnce({
      toArray: async () => [{ characterId: c1, seatsHeld: 1 }],
    });

    const result = await applyPlayerWhipToLeadership(
      db as unknown as Db,
      targetId,
      "speakerNominations",
      [c1]
    );

    expect(result).toEqual({ overridden: 0, alreadyAligned: 1 });
  });

  it("no-ops when eligibleCharacterIds is empty", async () => {
    const result = await applyPlayerWhipToLeadership(
      db as unknown as Db,
      new ObjectId(),
      "speakerNominations",
      []
    );
    expect(result).toEqual({ overridden: 0, alreadyAligned: 0 });
  });
});

describe("applyPlayerWhipToGovernmentVote", () => {
  let db: MockDb;

  beforeEach(() => {
    db = createMockDb();
  });

  it("writes aye/nay + snapshot on pmAppointmentVotes for each eligible character", async () => {
    const voteId = new ObjectId();
    const c1 = new ObjectId();
    const c2 = new ObjectId();

    db.collection("pmAppointmentVotes").findOne.mockResolvedValueOnce({
      _id: voteId,
      status: "active",
      votes: { [c1.toString()]: "nay" },
      votesFor: 0,
      votesAgainst: 1,
    });

    const result = await applyPlayerWhipToGovernmentVote(
      db as unknown as Db,
      voteId,
      "pmAppointmentVote",
      "for",
      [c1, c2]
    );

    expect(result.overridden).toBe(2);
    const updateCalls = db.collectionMocks["pmAppointmentVotes"]!.updateOne.mock.calls;
    expect(updateCalls).toHaveLength(1);
    const [, update] = updateCalls[0] as [unknown, { $set: Record<string, unknown> }];
    expect(update.$set[`votes.${c1.toString()}`]).toBe("aye");
    expect(update.$set[`votes.${c2.toString()}`]).toBe("aye");
    expect(update.$set[`whippedFromVote.${c1.toString()}`]).toBe("against");
    expect(update.$set[`whippedFromVote.${c2.toString()}`]).toBe("unvoted");
  });

  it("routes to noConfidenceVotes collection when targetType is noConfidenceVote", async () => {
    const voteId = new ObjectId();
    db.collection("noConfidenceVotes").findOne.mockResolvedValueOnce({
      _id: voteId,
      status: "active",
      votes: {},
      votesFor: 0,
      votesAgainst: 0,
    });

    await applyPlayerWhipToGovernmentVote(
      db as unknown as Db,
      voteId,
      "noConfidenceVote",
      "against",
      [new ObjectId()]
    );

    expect(db.collectionMocks["noConfidenceVotes"]!.updateOne).toHaveBeenCalledTimes(1);
    // pmAppointmentVotes collection should never have been accessed
    expect(db.collectionMocks["pmAppointmentVotes"]).toBeUndefined();
  });

  it("no-ops when the vote doc is not active", async () => {
    const voteId = new ObjectId();
    db.collection("pmAppointmentVotes").findOne.mockResolvedValueOnce({
      _id: voteId,
      status: "passed",
      votes: {},
    });

    const result = await applyPlayerWhipToGovernmentVote(
      db as unknown as Db,
      voteId,
      "pmAppointmentVote",
      "for",
      [new ObjectId()]
    );

    expect(result).toEqual({ overridden: 0, alreadyAligned: 0 });
    expect(db.collectionMocks["pmAppointmentVotes"]!.updateOne).not.toHaveBeenCalled();
  });
});

describe("applyPlayerWhipToCabinet", () => {
  let db: MockDb;

  beforeEach(() => {
    db = createMockDb();
  });

  it("overrides votes on cabinetNominations with snapshot", async () => {
    const nominationId = new ObjectId();
    const c1 = new ObjectId();

    db.collection("cabinetNominations").findOne.mockResolvedValueOnce({
      _id: nominationId,
      status: "active",
      votes: { [c1.toString()]: "against" },
      votesFor: 0,
      votesAgainst: 1,
    });

    const result = await applyPlayerWhipToCabinet(db as unknown as Db, nominationId, "for", [c1]);

    expect(result).toEqual({ overridden: 1, alreadyAligned: 0 });
    const [, update] = db.collectionMocks["cabinetNominations"]!.updateOne.mock.calls[0] as [
      unknown,
      { $set: Record<string, unknown> },
    ];
    expect(update.$set[`votes.${c1.toString()}`]).toBe("for");
    expect(update.$set[`whippedFromVote.${c1.toString()}`]).toBe("against");
  });

  it("no-ops when the nomination is not active", async () => {
    const nominationId = new ObjectId();
    db.collection("cabinetNominations").findOne.mockResolvedValueOnce({
      _id: nominationId,
      status: "confirmed",
      votes: {},
    });

    const result = await applyPlayerWhipToCabinet(db as unknown as Db, nominationId, "for", [
      new ObjectId(),
    ]);

    expect(result).toEqual({ overridden: 0, alreadyAligned: 0 });
    expect(db.collectionMocks["cabinetNominations"]!.updateOne).not.toHaveBeenCalled();
  });
});

describe("applyPlayerWhipToBill - concurrent (active_both) bills", () => {
  let db: MockDb;

  beforeEach(() => {
    db = createMockDb();
  });

  it("routes an UPPER-chamber member's vote AND weight to the upper chamber", async () => {
    const senator = new ObjectId();
    const bill = makeBill({
      status: "active_both",
      countryId: "US",
      originChamber: "house",
      currentChamber: "house",
      votes: {},
      otherChamberVotes: {},
    });
    db.collection("electedOfficials").find.mockReturnValue({
      toArray: async () => [{ characterId: senator, seatsHeld: 1, officeType: "senate" }],
    });

    await applyPlayerWhipToBill(db as unknown as Db, bill, "for", [senator]);

    const [, update] = db.collectionMocks["bills"]!.updateOne.mock.calls[0]!;
    const set = (update as { $set: Record<string, unknown> }).$set;
    const inc = (update as { $inc?: Record<string, number> }).$inc ?? {};

    // Assert the MAP and the COUNTER. The map alone leaves the $inc triple unproven,
    // and it is the counter that lets a bill pass on the other house's votes.
    expect(set).toHaveProperty(`otherChamberVotes.${senator.toString()}`);
    expect(set).toHaveProperty(`otherChamberWhippedFromVote.${senator.toString()}`);
    expect(inc.otherChamberVotesFor).toBe(1);
    expect(inc.votesFor).toBeUndefined();
  });

  it("routes a LOWER-chamber member to the lower chamber on the same bill", async () => {
    const rep = new ObjectId();
    const bill = makeBill({
      status: "active_both",
      countryId: "US",
      originChamber: "house",
      currentChamber: "house",
      votes: {},
      otherChamberVotes: {},
    });
    db.collection("electedOfficials").find.mockReturnValue({
      toArray: async () => [{ characterId: rep, seatsHeld: 1, officeType: "house" }],
    });

    await applyPlayerWhipToBill(db as unknown as Db, bill, "for", [rep]);

    const [, update] = db.collectionMocks["bills"]!.updateOne.mock.calls[0]!;
    const set = (update as { $set: Record<string, unknown> }).$set;
    const inc = (update as { $inc?: Record<string, number> }).$inc ?? {};
    expect(set).toHaveProperty(`votes.${rep.toString()}`);
    expect(inc.votesFor).toBe(1);
    expect(inc.otherChamberVotesFor).toBeUndefined();
  });

  it("splits a mixed whip across both chambers", async () => {
    const rep = new ObjectId();
    const senator = new ObjectId();
    const bill = makeBill({
      status: "active_both",
      countryId: "US",
      originChamber: "house",
      currentChamber: "house",
      votes: {},
      otherChamberVotes: {},
    });
    db.collection("electedOfficials").find.mockReturnValue({
      toArray: async () => [
        { characterId: rep, seatsHeld: 1, officeType: "house" },
        { characterId: senator, seatsHeld: 1, officeType: "senate" },
      ],
    });

    await applyPlayerWhipToBill(db as unknown as Db, bill, "for", [rep, senator]);

    const [, update] = db.collectionMocks["bills"]!.updateOne.mock.calls[0]!;
    const inc = (update as { $inc?: Record<string, number> }).$inc ?? {};
    expect(inc.votesFor).toBe(1);
    expect(inc.otherChamberVotesFor).toBe(1);
  });
});
