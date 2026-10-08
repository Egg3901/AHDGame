import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

const standingsMock = vi.fn();
vi.mock("@/lib/turn/election/contingentHouseVoteStandings", () => ({
  loadHouseVoteStandings: (...args: unknown[]) => standingsMock(...args),
}));

import { buildContingentHouseVoteView } from "./contingentHouseVoteView";

const election = { _id: new ObjectId(), countryId: "US" } as never;
const member = new ObjectId();

function tally(overrides: Record<string, unknown> = {}) {
  return {
    candidateNames: { a: "Ada Alpha", b: "Ben Beta" },
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
  } as never;
}

describe("buildContingentHouseVoteView", () => {
  let db: MockDb;
  beforeEach(() => {
    db = createMockDb();
    db.collection("electedOfficials").findOne.mockResolvedValue({ state: "OH" });
    standingsMock.mockReset().mockResolvedValue({
      delegationTotals: { a: 20, b: 24 },
      memberTotals: { a: 190, b: 200 },
      threshold: 26,
      delegationsVoting: 44,
    });
  });
  const build = (t: unknown, turn: number, viewer: ObjectId | null) =>
    buildContingentHouseVoteView(db as unknown as Db, election, t as never, turn, viewer);

  it("is null when the election has no House vote", async () => {
    expect(await build({}, 20, null)).toBeNull();
  });

  it("gives a sitting member their choice and the right to change it", async () => {
    const view = await build(tally(), 20, member);
    expect(view).toMatchObject({
      status: "open",
      turnsLeft: 14,
      threshold: 26,
      viewer: { isHouseMember: true, canVote: true, choiceId: "b" },
    });
    expect(view!.candidates).toEqual([
      { id: "a", name: "Ada Alpha", delegations: 20, members: 190 },
      { id: "b", name: "Ben Beta", delegations: 24, members: 200 },
    ]);
  });

  it("withholds voting from spectators, DC delegates and closed windows", async () => {
    expect((await build(tally(), 20, null))!.viewer).toEqual({
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
});
