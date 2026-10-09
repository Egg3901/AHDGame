import { describe, expect, it } from "vitest";
import type { ElectionDetail } from "../../components/ElectionDetailTypes";
import { replayFrame, replayTurns } from "./replayModel";

const snap = (turn: number, a: number, b: number) => ({
  turn,
  recordedAt: "2026-01-01T00:00:00.000Z",
  cumulativeVotes: { a, b },
  sharesPct: {},
});

const election = {
  generalVotes: {
    totalVotes: { a: 300, b: 250 },
    evByState: { OH: 18, PA: 19 },
    stateVoteData: {
      OH: { votesByCandidate: { a: 100, b: 150 }, evByCandidate: { b: 18 } },
      PA: { votesByCandidate: { a: 200, b: 100 }, evByCandidate: { a: 19 } },
    },
    stateVotesOverTime: {
      OH: [snap(10, 60, 40), snap(11, 100, 150)],
      PA: [snap(11, 200, 100)],
    },
    evByTurn: [
      { turn: 10, electoralVotesByCandidate: { a: 18 } },
      { turn: 11, electoralVotesByCandidate: { a: 19, b: 18 } },
    ],
  },
} as unknown as ElectionDetail;

describe("race replay", () => {
  it("lists every snapshot turn in order", () => {
    expect(replayTurns(election)).toEqual([10, 11]);
  });

  it("shows the race as it stood that week", () => {
    const f = replayFrame(election, 10);
    expect(f.week).toBe(1);
    expect(f.totals.ev).toEqual({ a: 18 });
    expect(f.totals.votes).toEqual({ a: 60, b: 40 });
    // A state with no snapshot yet has no result that week.
    expect(f.election.generalVotes?.stateVoteData?.PA.votesByCandidate).toEqual({});
    expect(f.election.generalVotes?.stateVotesOverTime?.OH).toHaveLength(1);
  });

  it("ends on the final standings", () => {
    const f = replayFrame(election, 11);
    expect(f.week).toBe(2);
    expect(f.totals.ev).toEqual({ a: 19, b: 18 });
    expect(f.totals.votes).toEqual({ a: 300, b: 250 });
  });
});
