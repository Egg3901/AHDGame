import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

const standingsMock = vi.fn();
const coalitionsMock = vi.fn();
vi.mock("@/lib/turn/election/contingentHouseVoteStandings", () => ({
  loadHouseVoteStandings: (...args: unknown[]) => standingsMock(...args),
  loadPartyCoalitions: (...args: unknown[]) => coalitionsMock(...args),
}));

import { buildContingentHouseVoteView } from "./contingentHouseVoteView";

const election = { _id: new ObjectId(), countryId: "US" } as never;
const member = new ObjectId();
const defier = new ObjectId();

function tally(overrides: Record<string, unknown> = {}, tallyOverrides = {}) {
  return {
    candidateNames: { a: "Ada Alpha", b: "Ben Beta" },
    contingentResult: { houseVoteTotals: { a: 20, b: 22 }, houseThreshold: 26 },
    contingentHouseVote: {
      status: "open",
      openedTurn: 10,
      closesTurn: 34,
      actingPresidentId: "x",
      actingPresidentName: "Acting Person",
      eligibleCandidateIds: ["a", "b"],
      votes: { [member.toString()]: "b" },
      ...overrides,
    },
    ...tallyOverrides,
  } as never;
}

function standings(extra: Record<string, unknown> = {}) {
  return {
    delegationVotes: { OH: "b", TX: null },
    delegationTotals: { a: 20, b: 24 },
    memberTotals: { a: 190, b: 200 },
    threshold: 26,
    delegationsVoting: 44,
    delegations: [
      { stateId: "OH", backing: "b", tied: false, weights: { b: 2 } },
      { stateId: "TX", backing: null, tied: true, weights: { a: 1, b: 1 } },
    ],
    defiances: [],
    activeCandidateIds: ["a", "b"],
    droppedCandidateIds: [],
    ...extra,
  };
}

describe("buildContingentHouseVoteView", () => {
  let db: MockDb;
  beforeEach(() => {
    db = createMockDb();
    db.collection("electedOfficials").findOne.mockResolvedValue({ state: "OH" });
    db.collection("characters").findOne.mockResolvedValue({ party: "3" });
    db.collection("characters").find.mockReturnValue({
      project: () => ({ toArray: async () => [{ _id: defier, name: "Dana Defier" }] }),
    });
    db.collection("politicalParties").find.mockReturnValue({
      project: () => ({
        toArray: async () => [
          { sequentialId: 3, name: "Party Three", chairId: null },
          { sequentialId: 4, name: "Party Four", chairId: member },
        ],
      }),
    });
    db.collection("coalitions").find.mockReturnValue({
      project: () => ({
        toArray: async () => [{ sequentialId: 7, name: "Coalition Seven", chairCharacterId: null }],
      }),
    });
    coalitionsMock.mockReset().mockResolvedValue({ "3": "7" });
    standingsMock.mockReset().mockResolvedValue(standings());
  });
  const build = (t: unknown, turn: number, viewer: ObjectId | null) =>
    buildContingentHouseVoteView(db as unknown as Db, election, t as never, turn, viewer);

  it("is null when the election has no House vote", async () => {
    expect(await build({}, 20, null)).toBeNull();
  });

  it("gives a sitting member their choice, the grid and the opening ballot", async () => {
    const view = await build(tally(), 20, member);
    expect(view).toMatchObject({
      status: "open",
      turnsLeft: 14,
      threshold: 26,
      viewer: { isHouseMember: true, canVote: true, choiceId: "b", whip: null },
    });
    expect(view!.candidates).toEqual([
      { id: "a", name: "Ada Alpha", delegations: 20, members: 190, dropped: false },
      { id: "b", name: "Ben Beta", delegations: 24, members: 200, dropped: false },
    ]);
    expect(view!.delegations).toEqual([
      { stateId: "OH", backing: "b", tied: false },
      { stateId: "TX", backing: null, tied: true },
    ]);
    expect(view!.ballots).toEqual([
      { turn: 10, opening: true, totals: { a: 20, b: 22 }, winnerId: null },
    ]);
  });

  it("lists whips in force and the one that applies to the viewer's party", async () => {
    const view = await build(
      tally({
        whips: {
          "coalition:7": {
            candidateId: "a",
            setBy: "u",
            setByName: "Coal Chair",
            setAt: new Date(),
            turn: 12,
          },
          "party:4": {
            candidateId: "free",
            setBy: "u",
            setByName: "Four Chair",
            setAt: new Date(),
            turn: 13,
          },
          "party:99": {
            candidateId: "a",
            setBy: "u",
            setByName: "Ghost",
            setAt: new Date(),
            turn: 13,
          },
        },
      }),
      20,
      member
    );
    // The unknown party's whip is not shown.
    expect(view!.whips.map((w) => [w.key, w.name, w.candidateId])).toEqual([
      ["coalition:7", "Coalition Seven", "a"],
      ["party:4", "Party Four", "free"],
    ]);
    // Viewer is in party 3, which has no whip of its own: the coalition whip applies.
    expect(view!.viewer.whip).toEqual({
      name: "Coalition Seven",
      scope: "coalition",
      candidateId: "a",
    });
  });

  it("offers whip controls only to the chair, only while open", async () => {
    const view = await build(
      tally({
        whips: {
          "party:4": { candidateId: "a", setBy: "u", setByName: "x", setAt: new Date(), turn: 1 },
        },
      }),
      20,
      member
    );
    expect(view!.viewer.canWhip).toEqual([
      { scope: "party", sequentialId: 4, name: "Party Four", current: "a" },
    ]);
    expect((await build(tally(), 34, member))!.viewer.canWhip).toEqual([]);
    expect((await build(tally(), 20, null))!.viewer.canWhip).toEqual([]);
  });

  it("names members who defied their whip and flags dropped candidacies", async () => {
    standingsMock.mockResolvedValue(
      standings({
        defiances: [
          {
            voterId: defier.toString(),
            stateId: "OH",
            candidateId: "b",
            whipCandidateId: "a",
            whipKey: "party:3",
          },
        ],
        droppedCandidateIds: ["b"],
      })
    );
    const view = await build(tally(), 20, null);
    expect(view!.defiances).toEqual([
      { name: "Dana Defier", stateId: "OH", candidateId: "b", whipCandidateId: "a" },
    ]);
    expect(view!.candidates.find((c) => c.id === "b")!.dropped).toBe(true);
  });

  it("withholds voting from spectators, DC delegates and closed windows", async () => {
    expect((await build(tally(), 20, null))!.viewer).toMatchObject({
      isHouseMember: false,
      canVote: false,
      choiceId: null,
    });
    db.collectionMocks.electedOfficials!.findOne.mockResolvedValue({ state: "DC" });
    expect((await build(tally(), 20, member))!.viewer.isHouseMember).toBe(false);
    db.collectionMocks.electedOfficials!.findOne.mockResolvedValue({ state: "OH" });
    const closed = await build(tally(), 34, member);
    expect(closed!.turnsLeft).toBe(0);
    expect(closed!.viewer).toMatchObject({ isHouseMember: true, canVote: false });
  });

  it("shows the final recorded ballot after close without recomputing", async () => {
    const view = await build(
      tally({
        status: "closed",
        closedTurn: 15,
        presidentWinnerId: "b",
        ballots: [
          { turn: 12, delegationVotes: { OH: "a" }, totals: { a: 25, b: 24 }, winnerId: null },
          {
            turn: 15,
            delegationVotes: { OH: "b", TX: "b" },
            totals: { a: 24, b: 26 },
            winnerId: "b",
          },
        ],
      }),
      16,
      member
    );
    expect(standingsMock).not.toHaveBeenCalled();
    expect(view).toMatchObject({ status: "closed", winnerId: "b" });
    expect(view!.candidates.map((c) => [c.id, c.delegations, c.members])).toEqual([
      ["a", 24, null],
      ["b", 26, null],
    ]);
    expect(view!.ballots.map((b) => [b.turn, b.opening])).toEqual([
      [10, true],
      [12, false],
      [15, false],
    ]);
    expect(view!.delegations).toEqual([
      { stateId: "OH", backing: "b", tied: false },
      { stateId: "TX", backing: "b", tied: false },
    ]);
    expect(view!.viewer.canVote).toBe(false);
  });
});
