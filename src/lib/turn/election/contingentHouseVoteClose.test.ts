import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

const seat = vi.fn();
const tenure = vi.fn();
const standingsMock = vi.fn();
const notify = vi.fn();
vi.mock("@/lib/turn/election/presidentExecutiveSeating", () => ({
  seatPresidentialExecutive: (...args: unknown[]) => seat(...args),
}));
vi.mock("@/lib/turn/election/presidentialTenureLedger", () => ({
  recordPresidentialTenure: (...args: unknown[]) => tenure(...args),
}));
vi.mock("@/lib/turn/election/contingentHouseVoteStandings", () => ({
  loadHouseVoteStandings: (...args: unknown[]) => standingsMock(...args),
}));
vi.mock("@/lib/notifications", () => ({
  createNotifications: (...args: unknown[]) => notify(...args),
}));

import { closeDueContingentHouseVotes } from "./contingentHouseVoteClose";

const electionId = new ObjectId();
const tallyId = new ObjectId();
const winnerCandidateId = new ObjectId();
const actingId = new ObjectId();
const winnerCharId = new ObjectId();
const userId = new ObjectId();

function openTally(overrides: Record<string, unknown> = {}) {
  return {
    _id: tallyId,
    electionId,
    electoralVotesByCandidate: { [winnerCandidateId.toString()]: 200 },
    contingentResult: { houseBallots: [{ ballot: 1 }], houseDeadlocked: true },
    contingentHouseVote: {
      status: "open",
      openedTurn: 10,
      closesTurn: 34,
      actingPresidentId: actingId.toString(),
      actingPresidentName: "Acting Person",
      eligibleCandidateIds: [winnerCandidateId.toString()],
      votes: {},
      ...overrides,
    },
  };
}

function standings(winner: string | null) {
  return {
    delegationVotes: { AA: winner },
    delegationTotals: { [winnerCandidateId.toString()]: winner ? 26 : 10 },
    memberTotals: {},
    threshold: 26,
    delegationsVoting: 1,
    majorityWinnerId: winner,
    leaderId: winner,
    explicitVoters: 0,
  };
}

describe("closeDueContingentHouseVotes", () => {
  let db: MockDb;
  const now = new Date("2026-10-08T12:00:00Z");

  beforeEach(() => {
    seat.mockReset();
    tenure.mockReset();
    standingsMock.mockReset();
    notify.mockReset().mockResolvedValue(undefined);
    db = createMockDb();
    db.collection("electionVoteTallies").findOne.mockResolvedValue(null);
    db.collection("elections").findOne.mockResolvedValue({ _id: electionId, countryId: "US" });
    db.collection("electionCandidates").findOne.mockResolvedValue({
      _id: winnerCandidateId,
      electionId,
      characterId: winnerCharId,
      characterName: "Winner",
      party: "1",
      isNPP: false,
    });
    db.collection("characters").findOne.mockResolvedValue({ userId });
    db.collection("electionVoteTallies").updateOne.mockResolvedValue({
      matchedCount: 1,
      modifiedCount: 1,
    });
  });

  const run = (turn: number) => closeDueContingentHouseVotes(db as unknown as Db, now, turn);

  /** First findOne is the pending-seating probe, second the due probe. */
  function dueTally(tally: unknown, claimed?: unknown) {
    db.collectionMocks
      .electionVoteTallies!.findOne.mockResolvedValueOnce(null)
      .mockResolvedValueOnce(tally)
      .mockResolvedValueOnce(claimed ?? null);
  }

  it("does nothing while the window is open", async () => {
    // The query itself filters on closesTurn <= currentTurn.
    expect(await run(20)).toBe(0);
    const dueQuery = db.collectionMocks.electionVoteTallies!.findOne.mock.calls[1][0];
    expect(dueQuery).toMatchObject({
      "contingentHouseVote.status": "open",
      "contingentHouseVote.closesTurn": { $lte: 20 },
    });
    expect(seat).not.toHaveBeenCalled();
  });

  it("seats the majority winner with the acting president as vice president", async () => {
    const winner = winnerCandidateId.toString();
    standingsMock.mockResolvedValue(standings(winner));
    const claimedTally = openTally({
      status: "closed",
      presidentWinnerId: winner,
      seatingPending: true,
    });
    dueTally(openTally(), claimedTally);

    expect(await run(34)).toBe(1);

    const claim = db.collectionMocks.electionVoteTallies!.updateOne.mock.calls[0];
    expect(claim[0]).toMatchObject({ _id: tallyId, "contingentHouseVote.status": "open" });
    expect(claim[1].$set).toMatchObject({
      "contingentHouseVote.status": "closed",
      "contingentHouseVote.closedTurn": 34,
      "contingentHouseVote.presidentWinnerId": winner,
      "contingentResult.presidentWinnerId": winner,
      "contingentResult.houseDeadlocked": false,
      resolutionMode: "contingent",
    });
    expect(claim[1].$push["contingentResult.houseBallots"].ballot).toBe(2);

    expect(seat).toHaveBeenCalledTimes(1);
    const params = seat.mock.calls[0][1];
    expect(params.winnerCandidate._id.equals(winnerCandidateId)).toBe(true);
    expect(params.vpCharId.equals(actingId)).toBe(true);
    expect(tenure).toHaveBeenCalledWith(expect.anything(), "US", "1", electionId.toString());

    const lastWrite = db.collectionMocks.electionVoteTallies!.updateOne.mock.calls.at(-1)!;
    expect(lastWrite[1].$set["contingentHouseVote.seatingPending"]).toBe(false);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("closes with no winner and seats nobody when no candidate has a majority", async () => {
    standingsMock.mockResolvedValue(standings(null));
    dueTally(openTally());

    expect(await run(40)).toBe(1);

    const set = db.collectionMocks.electionVoteTallies!.updateOne.mock.calls[0][1].$set;
    expect(set).toMatchObject({
      "contingentHouseVote.status": "closed",
      "contingentHouseVote.closedTurn": 40,
    });
    expect(set["contingentHouseVote.presidentWinnerId"]).toBeUndefined();
    expect(set["contingentResult.houseDeadlocked"]).toBeUndefined();
    expect(seat).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it("does not seat when another worker already claimed the close", async () => {
    standingsMock.mockResolvedValue(standings(winnerCandidateId.toString()));
    dueTally(openTally());
    db.collectionMocks.electionVoteTallies!.updateOne.mockResolvedValueOnce({
      matchedCount: 0,
      modifiedCount: 0,
    });

    expect(await run(34)).toBe(0);
    expect(seat).not.toHaveBeenCalled();
  });

  it("retries only the seating after a crash, without recomputing the vote", async () => {
    const winner = winnerCandidateId.toString();
    db.collectionMocks
      .electionVoteTallies!.findOne.mockResolvedValueOnce(
        openTally({ status: "closed", presidentWinnerId: winner, seatingPending: true })
      )
      .mockResolvedValueOnce(null);

    expect(await run(35)).toBe(1);

    expect(standingsMock).not.toHaveBeenCalled();
    expect(seat).toHaveBeenCalledTimes(1);
    // A second pass finds nothing pending and nothing open: no double seat.
    db.collectionMocks.electionVoteTallies!.findOne.mockResolvedValue(null);
    expect(await run(36)).toBe(0);
    expect(seat).toHaveBeenCalledTimes(1);
  });

  it("keeps seating pending when seating throws", async () => {
    const winner = winnerCandidateId.toString();
    seat.mockRejectedValueOnce(new Error("db down"));
    db.collectionMocks
      .electionVoteTallies!.findOne.mockResolvedValueOnce(
        openTally({ status: "closed", presidentWinnerId: winner, seatingPending: true })
      )
      .mockResolvedValueOnce(null);

    expect(await run(35)).toBe(0);
    expect(db.collectionMocks.electionVoteTallies!.updateOne).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it("stays inert for a non-US election", async () => {
    db.collectionMocks.elections!.findOne.mockResolvedValue({ _id: electionId, countryId: "UK" });
    dueTally(openTally());
    expect(await run(40)).toBe(0);
    expect(standingsMock).not.toHaveBeenCalled();
  });
});
