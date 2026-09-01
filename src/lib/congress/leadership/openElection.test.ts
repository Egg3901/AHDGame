import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { buildChamberLeadershipContext } from "@/lib/congress/leadership/rolePolicy";

vi.mock("@/lib/time/gameTime", () => ({
  getGameTime: vi.fn().mockResolvedValue({
    currentTurn: 500,
    effectiveNow: new Date("2026-05-30T12:00:00Z"),
    lastTurnProcessed: new Date("2026-05-30T12:00:00Z"),
    isActive: true,
    pausedAt: null,
  }),
}));

const CTX = buildChamberLeadershipContext({
  composition: [{ party: "MAJ", partyName: "Majority Party" }, { party: "OPP" }],
  majorityParty: "MAJ",
  majorityBloc: null,
});

describe("openCongressLeadershipElection", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    for (const name of [
      "congressLeaders",
      "electedOfficials",
      "characters",
      "senateLeadershipElections",
      "senateLeadershipNominations",
      "houseLeadershipElections",
      "houseLeadershipNominations",
    ]) {
      db.collection(name);
    }
    db.collectionMocks["senateLeadershipElections"]!.findOne.mockResolvedValue(null);
    db.collectionMocks["houseLeadershipElections"]!.findOne.mockResolvedValue(null);
    db.collectionMocks["congressLeaders"]!.findOne.mockResolvedValue(null);
  });

  it("writes endsOnTurn alongside endsAt so the fresh window is turn-anchored", async () => {
    const { openCongressLeadershipElection } = await import("./openElection");
    const now = new Date("2026-05-30T12:00:00Z");

    const opened = await openCongressLeadershipElection(db as unknown as Db, {
      role: "pro_tempore",
      chamber: "senate",
      ctx: CTX,
      now,
    });

    expect(opened).toBe(true);
    expect(db.collectionMocks["senateLeadershipElections"]!.updateOne).toHaveBeenCalledWith(
      { _id: "pro_tempore" },
      {
        $set: expect.objectContaining({
          _id: "pro_tempore",
          status: "voting",
          startedAt: now,
          endsOnTurn: 524,
          endsAt: new Date("2026-05-31T12:00:00Z"),
        }),
      },
      { upsert: true }
    );
  });

  it("overwrites a stale endsOnTurn left by a previous election", async () => {
    // Regression: the admin start_election handlers used to $set only `endsAt`,
    // so a stale `endsOnTurn` from the previous race survived the upsert. Because
    // `isLeadershipElectionClosed` PREFERS endsOnTurn, the freshly opened election
    // read as already closed and resolved instantly on the very next GET —
    // re-crowning the auto-nominated incumbent and re-posting the victory webhook.
    db.collectionMocks["senateLeadershipElections"]!.findOne.mockResolvedValue({
      _id: "pro_tempore",
      status: "closed",
      endsOnTurn: 12,
      endsAt: new Date("2020-01-01T00:00:00Z"),
    });

    const { openCongressLeadershipElection } = await import("./openElection");
    await openCongressLeadershipElection(db as unknown as Db, {
      role: "pro_tempore",
      chamber: "senate",
      ctx: CTX,
      now: new Date("2026-05-30T12:00:00Z"),
    });

    const [, update] = db.collectionMocks["senateLeadershipElections"]!.updateOne.mock.calls[0]!;
    expect(update.$set.endsOnTurn).toBe(524);

    const { isLeadershipElectionClosed } = await import("@/lib/congress/leadershipElections");
    expect(isLeadershipElectionClosed(update.$set, 500, new Date("2026-05-30T12:00:00Z"))).toBe(
      false
    );
  });

  it("refuses to reopen while a live election is still running", async () => {
    db.collectionMocks["senateLeadershipElections"]!.findOne.mockResolvedValue({
      _id: "majority_leader",
      status: "voting",
      endsOnTurn: 510,
    });

    const { openCongressLeadershipElection } = await import("./openElection");
    const opened = await openCongressLeadershipElection(db as unknown as Db, {
      role: "majority_leader",
      chamber: "senate",
      ctx: CTX,
      now: new Date("2026-05-30T12:00:00Z"),
    });

    expect(opened).toBe(false);
    expect(db.collectionMocks["senateLeadershipElections"]!.updateOne).not.toHaveBeenCalled();
  });

  it("reopens when the stored election has expired on the turn clock", async () => {
    db.collectionMocks["houseLeadershipElections"]!.findOne.mockResolvedValue({
      _id: "majority_whip",
      status: "voting",
      endsOnTurn: 499,
    });

    const { openCongressLeadershipElection } = await import("./openElection");
    const opened = await openCongressLeadershipElection(db as unknown as Db, {
      role: "majority_whip",
      chamber: "house",
      ctx: CTX,
      now: new Date("2026-05-30T12:00:00Z"),
    });

    expect(opened).toBe(true);
    expect(db.collectionMocks["houseLeadershipElections"]!.updateOne).toHaveBeenCalled();
  });

  it("fails any dangling nominations for the role before opening", async () => {
    const { openCongressLeadershipElection } = await import("./openElection");
    const now = new Date("2026-05-30T12:00:00Z");

    await openCongressLeadershipElection(db as unknown as Db, {
      role: "minority_leader",
      chamber: "senate",
      ctx: CTX,
      now,
    });

    expect(db.collectionMocks["senateLeadershipNominations"]!.updateMany).toHaveBeenCalledWith(
      { role: "minority_leader", status: { $in: ["open", "voting"] } },
      { $set: { status: "failed", updatedAt: now } }
    );
  });

  it("auto-nominates a seated, still-eligible incumbent", async () => {
    const incumbentId = new ObjectId();
    db.collectionMocks["congressLeaders"]!.findOne.mockResolvedValue({
      role: "majority_leader_senate",
      characterId: incumbentId,
      characterName: "Sitting Leader",
      party: "MAJ",
    });
    db.collectionMocks["electedOfficials"]!.findOne.mockResolvedValue({
      _id: new ObjectId(),
      officeType: "senate",
      characterId: incumbentId,
      party: "MAJ",
      state: "TN",
    });
    db.collectionMocks["characters"]!.findOne.mockResolvedValue({
      _id: incumbentId,
      party: "MAJ",
      homeState: "TN",
    });

    const { openCongressLeadershipElection } = await import("./openElection");
    await openCongressLeadershipElection(db as unknown as Db, {
      role: "majority_leader",
      chamber: "senate",
      ctx: CTX,
      now: new Date("2026-05-30T12:00:00Z"),
    });

    expect(db.collectionMocks["senateLeadershipNominations"]!.insertOne).toHaveBeenCalledWith(
      expect.objectContaining({
        role: "majority_leader",
        nomineeId: incumbentId,
        nomineeParty: "MAJ",
        nominatedByName: "Incumbent",
        status: "voting",
      })
    );
  });

  it("does not auto-nominate an incumbent whose current party is no longer eligible", async () => {
    const incumbentId = new ObjectId();
    db.collectionMocks["congressLeaders"]!.findOne.mockResolvedValue({
      role: "majority_leader_senate",
      characterId: incumbentId,
      characterName: "Defector",
      // Stale cached party — the live seat row below is the truth.
      party: "MAJ",
    });
    db.collectionMocks["electedOfficials"]!.findOne.mockResolvedValue({
      _id: new ObjectId(),
      officeType: "senate",
      characterId: incumbentId,
      party: "independent",
    });
    db.collectionMocks["characters"]!.findOne.mockResolvedValue({
      _id: incumbentId,
      party: "independent",
    });

    const { openCongressLeadershipElection } = await import("./openElection");
    await openCongressLeadershipElection(db as unknown as Db, {
      role: "majority_leader",
      chamber: "senate",
      ctx: CTX,
      now: new Date("2026-05-30T12:00:00Z"),
    });

    expect(db.collectionMocks["senateLeadershipNominations"]!.insertOne).not.toHaveBeenCalled();
  });

  it("does not auto-nominate an incumbent who no longer holds a chamber seat", async () => {
    const incumbentId = new ObjectId();
    db.collectionMocks["congressLeaders"]!.findOne.mockResolvedValue({
      role: "majority_leader_senate",
      characterId: incumbentId,
      characterName: "Unseated Leader",
      party: "MAJ",
    });
    db.collectionMocks["electedOfficials"]!.findOne.mockResolvedValue(null);

    const { openCongressLeadershipElection } = await import("./openElection");
    await openCongressLeadershipElection(db as unknown as Db, {
      role: "majority_leader",
      chamber: "senate",
      ctx: CTX,
      now: new Date("2026-05-30T12:00:00Z"),
    });

    expect(db.collectionMocks["senateLeadershipNominations"]!.insertOne).not.toHaveBeenCalled();
  });

  it("skips auto-nomination entirely when skipIncumbentNomination is set", async () => {
    const incumbentId = new ObjectId();
    db.collectionMocks["congressLeaders"]!.findOne.mockResolvedValue({
      role: "majority_leader_senate",
      characterId: incumbentId,
      characterName: "Sitting Leader",
      party: "MAJ",
    });

    const { openCongressLeadershipElection } = await import("./openElection");
    await openCongressLeadershipElection(db as unknown as Db, {
      role: "majority_leader",
      chamber: "senate",
      ctx: CTX,
      now: new Date("2026-05-30T12:00:00Z"),
      skipIncumbentNomination: true,
    });

    expect(db.collectionMocks["senateLeadershipNominations"]!.insertOne).not.toHaveBeenCalled();
    expect(db.collectionMocks["congressLeaders"]!.findOne).not.toHaveBeenCalled();
  });
});
