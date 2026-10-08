import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

const seat = vi.fn();
const tenure = vi.fn();
const standingsMock = vi.fn();
const notify = vi.fn();
const noticeClosed = vi.fn();
const noticeReminder = vi.fn();
vi.mock("@/lib/turn/election/presidentExecutiveSeating", () => ({
  seatPresidentialExecutive: (...args: unknown[]) => seat(...args),
}));
vi.mock("@/lib/turn/election/presidentialTenureLedger", () => ({
  recordPresidentialTenure: (...args: unknown[]) => tenure(...args),
}));
vi.mock("@/lib/turn/election/contingentHouseVoteStandings", () => ({
  loadHouseVoteStandings: (...args: unknown[]) => standingsMock(...args),
}));
vi.mock("@/lib/turn/election/contingentHouseVoteNotices", () => ({
  notifyHouseVoteClosed: (...args: unknown[]) => noticeClosed(...args),
  notifyHouseVoteReminder: (...args: unknown[]) => noticeReminder(...args),
}));
vi.mock("@/lib/notifications", () => ({
  createNotifications: (...args: unknown[]) => notify(...args),
}));

import { closeDueContingentHouseVotes } from "./contingentHouseVoteClose";

const electionId = new ObjectId();
const tallyId = new ObjectId();
const winnerCandidateId = new ObjectId();
const otherCandidateId = new ObjectId();
const actingId = new ObjectId();
const winnerCharId = new ObjectId();
const userId = new ObjectId();

function openTally(overrides: Record<string, unknown> = {}) {
  return {
    _id: tallyId,
    electionId,
    electoralVotesByCandidate: { [winnerCandidateId.toString()]: 200 },
    candidateNames: {
      [winnerCandidateId.toString()]: "Winner",
      [otherCandidateId.toString()]: "Other",
    },
    contingentResult: {
      houseBallots: [{ ballot: 1 }],
      houseDeadlocked: true,
      houseDelegationVotes: { AA: otherCandidateId.toString() },
    },
    contingentHouseVote: {
      status: "open",
      openedTurn: 10,
      closesTurn: 34,
      actingPresidentId: actingId.toString(),
      actingPresidentName: "Acting Person",
      eligibleCandidateIds: [winnerCandidateId.toString(), otherCandidateId.toString()],
      votes: {},
      ...overrides,
    },
  };
}

function standings(winner: string | null, votes: Record<string, string | null> = { AA: winner }) {
  return {
    delegationVotes: votes,
    delegationTotals: { [winnerCandidateId.toString()]: winner ? 26 : 10 },
    memberTotals: {},
    threshold: 26,
    delegationsVoting: 1,
    majorityWinnerId: winner,
    leaderId: winnerCandidateId.toString(),
    explicitVoters: 0,
    delegations: [],
    defiances: [],
    activeCandidateIds: [winnerCandidateId.toString(), otherCandidateId.toString()],
    droppedCandidateIds: [],
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
    noticeClosed.mockReset().mockResolvedValue(undefined);
    noticeReminder.mockReset().mockResolvedValue(3);
    db = createMockDb();
    db.collection("electionVoteTallies").findOne.mockResolvedValue(null);
    db.collection("electionVoteTallies").find.mockReturnValue({
      toArray: async () => [],
    });
    db.collection("elections").findOne.mockResolvedValue({ _id: electionId, countryId: "US" });
    db.collection("elections").find.mockReturnValue({
      toArray: async () => [{ _id: electionId, countryId: "US" }],
    });
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

  /** The pending-seating probe finds nothing; the ballot query returns `tally`. */
  function openVotes(tally: unknown, claimed?: unknown) {
    db.collectionMocks.electionVoteTallies!.find.mockReturnValue({
      toArray: async () => [tally],
    });
    db.collectionMocks
      .electionVoteTallies!.findOne.mockResolvedValueOnce(null)
      .mockResolvedValueOnce(claimed ?? null);
  }

  it("ballots only votes opened on an earlier turn and not already balloted this turn", async () => {
    expect(await run(20)).toBe(0);
    const query = db.collectionMocks.electionVoteTallies!.find.mock.calls[0][0];
    expect(query).toMatchObject({
      "contingentHouseVote.status": "open",
      "contingentHouseVote.openedTurn": { $lt: 20 },
      "contingentHouseVote.lastBallotTurn": { $ne: 20 },
    });
    expect(seat).not.toHaveBeenCalled();
  });

  it("seats the majority winner as soon as a ballot shows one, before the window ends", async () => {
    const winner = winnerCandidateId.toString();
    standingsMock.mockResolvedValue(standings(winner));
    const claimedTally = openTally({
      status: "closed",
      presidentWinnerId: winner,
      seatingPending: true,
    });
    openVotes(openTally(), claimedTally);

    expect(await run(12)).toBe(1);

    const claim = db.collectionMocks.electionVoteTallies!.updateOne.mock.calls[0];
    expect(claim[0]).toMatchObject({
      _id: tallyId,
      "contingentHouseVote.status": "open",
      "contingentHouseVote.lastBallotTurn": { $ne: 12 },
    });
    expect(claim[1].$set).toMatchObject({
      "contingentHouseVote.status": "closed",
      "contingentHouseVote.closedTurn": 12,
      "contingentHouseVote.lastBallotTurn": 12,
      "contingentHouseVote.presidentWinnerId": winner,
      "contingentResult.presidentWinnerId": winner,
      "contingentResult.houseDeadlocked": false,
      resolutionMode: "contingent",
    });
    expect(claim[1].$push["contingentResult.houseBallots"].ballot).toBe(2);
    expect(claim[1].$push["contingentHouseVote.ballots"]).toMatchObject({
      turn: 12,
      winnerId: winner,
    });

    expect(seat).toHaveBeenCalledTimes(1);
    const params = seat.mock.calls[0][1];
    expect(params.winnerCandidate._id.equals(winnerCandidateId)).toBe(true);
    expect(params.vpCharId.equals(actingId)).toBe(true);
    expect(tenure).toHaveBeenCalledWith(expect.anything(), "US", "1", electionId.toString());

    const lastWrite = db.collectionMocks.electionVoteTallies!.updateOne.mock.calls.at(-1)!;
    expect(lastWrite[1].$set["contingentHouseVote.seatingPending"]).toBe(false);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(noticeClosed).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      { winnerName: "Winner", delegations: 26, threshold: 26 }
    );
  });

  it("leaves the vice presidency vacant when the acting president has left the game", async () => {
    const winner = winnerCandidateId.toString();
    standingsMock.mockResolvedValue(standings(winner));
    openVotes(
      openTally(),
      openTally({ status: "closed", presidentWinnerId: winner, seatingPending: true })
    );
    // The winner's character exists, the acting president's does not.
    db.collectionMocks.characters!.findOne.mockImplementation(async (filter: { _id: ObjectId }) =>
      filter._id.equals(actingId) ? null : { userId }
    );

    expect(await run(12)).toBe(1);

    expect(seat).toHaveBeenCalledTimes(1);
    expect(seat.mock.calls[0][1].vpCharId).toBeUndefined();
  });

  it("records the ballot and keeps the vote open when there is no majority yet", async () => {
    standingsMock.mockResolvedValue(standings(null, { AA: otherCandidateId.toString() }));
    openVotes(openTally());

    expect(await run(12)).toBe(1);

    const [filter, update] = db.collectionMocks.electionVoteTallies!.updateOne.mock.calls[0];
    expect(filter).toMatchObject({ "contingentHouseVote.status": "open" });
    expect(update.$set["contingentHouseVote.status"]).toBeUndefined();
    expect(update.$set["contingentHouseVote.lastBallotTurn"]).toBe(12);
    expect(update.$push["contingentHouseVote.ballots"]).toMatchObject({
      turn: 12,
      winnerId: null,
    });
    expect(seat).not.toHaveBeenCalled();
    expect(noticeClosed).not.toHaveBeenCalled();
  });

  it("closes with no winner once the window has passed without a majority", async () => {
    standingsMock.mockResolvedValue(standings(null));
    openVotes(openTally());

    expect(await run(34)).toBe(1);

    const set = db.collectionMocks.electionVoteTallies!.updateOne.mock.calls[0][1].$set;
    expect(set).toMatchObject({
      "contingentHouseVote.status": "closed",
      "contingentHouseVote.closedTurn": 34,
    });
    expect(set["contingentHouseVote.presidentWinnerId"]).toBeUndefined();
    expect(set["contingentResult.houseDeadlocked"]).toBeUndefined();
    expect(seat).not.toHaveBeenCalled();
    expect(noticeClosed).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ winnerName: null })
    );
  });

  it("still elects a majority winner on the closing ballot", async () => {
    const winner = winnerCandidateId.toString();
    standingsMock.mockResolvedValue(standings(winner));
    openVotes(
      openTally(),
      openTally({ status: "closed", presidentWinnerId: winner, seatingPending: true })
    );
    expect(await run(40)).toBe(1);
    expect(seat).toHaveBeenCalledTimes(1);
  });

  it("does not seat or notify when another worker already claimed the ballot", async () => {
    standingsMock.mockResolvedValue(standings(winnerCandidateId.toString()));
    openVotes(openTally());
    db.collectionMocks.electionVoteTallies!.updateOne.mockResolvedValueOnce({
      matchedCount: 0,
      modifiedCount: 0,
    });

    expect(await run(34)).toBe(0);
    expect(seat).not.toHaveBeenCalled();
    expect(noticeClosed).not.toHaveBeenCalled();
  });

  describe("reminders", () => {
    it("reminds members once when the board moved since the opening ballot", async () => {
      standingsMock.mockResolvedValue(standings(null, { AA: winnerCandidateId.toString() }));
      openVotes(openTally());

      await run(12);

      expect(noticeReminder).toHaveBeenCalledTimes(1);
      const reminderClaim = db.collectionMocks.electionVoteTallies!.updateOne.mock.calls[1];
      expect(reminderClaim[0]).toMatchObject({
        "contingentHouseVote.lastReminderTurn": { $ne: 12 },
      });
      expect(noticeReminder.mock.calls[0][3]).toMatchObject({
        leaderName: "Winner",
        threshold: 26,
      });
    });

    it("stays quiet when nothing changed since the previous ballot", async () => {
      standingsMock.mockResolvedValue(standings(null, { AA: otherCandidateId.toString() }));
      openVotes(openTally());
      await run(12);
      expect(noticeReminder).not.toHaveBeenCalled();

      // Later: compared against the last recorded ballot, not the opening one.
      noticeReminder.mockClear();
      standingsMock.mockResolvedValue(standings(null, { AA: winnerCandidateId.toString() }));
      openVotes(
        openTally({
          ballots: [
            {
              turn: 12,
              delegationVotes: { AA: winnerCandidateId.toString() },
              totals: {},
              winnerId: null,
            },
          ],
          lastBallotTurn: 12,
        })
      );
      await run(13);
      expect(noticeReminder).not.toHaveBeenCalled();
    });

    it("sends no second reminder in a turn another worker already claimed", async () => {
      standingsMock.mockResolvedValue(standings(null, { AA: winnerCandidateId.toString() }));
      openVotes(openTally());
      db.collectionMocks
        .electionVoteTallies!.updateOne.mockResolvedValueOnce({ matchedCount: 1, modifiedCount: 1 })
        .mockResolvedValueOnce({ matchedCount: 1, modifiedCount: 0 });
      await run(12);
      expect(noticeReminder).not.toHaveBeenCalled();
    });
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
    db.collectionMocks.elections!.find.mockReturnValue({
      toArray: async () => [{ _id: electionId, countryId: "UK" }],
    });
    openVotes(openTally());
    expect(await run(40)).toBe(0);
    expect(standingsMock).not.toHaveBeenCalled();
  });

  it("survives a failing ballot and retries next turn", async () => {
    standingsMock.mockRejectedValue(new Error("db down"));
    openVotes(openTally());
    expect(await run(12)).toBe(0);
    expect(db.collectionMocks.electionVoteTallies!.updateOne).not.toHaveBeenCalled();
  });
});
