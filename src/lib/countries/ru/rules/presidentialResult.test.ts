import { describe, expect, it } from "vitest";
import {
  decideRussianPresidentialResult as decide,
  type RussianPresidentialBallot,
} from "./presidentialResult";
const first: RussianPresidentialBallot = {
  round: 1,
  candidateIds: ["a", "b", "c"],
  votesFor: { a: 31, b: 20, c: 9 },
  votesAgainst: { a: 29, b: 40, c: 51 },
  registeredVoters: 100,
  participants: 60,
};
describe("Russian 1991 direct presidential result", () => {
  it("reopens filing when nobody stood for election", () => {
    expect(
      decide({ ...first, candidateIds: [], votesFor: {}, votesAgainst: {}, participants: 0 })
    ).toEqual({ outcome: "repeat", reason: "no-candidates" });
  });
  it("repeats an invalidated ballot without electing its apparent winner", () => {
    expect(decide({ ...first, invalidated: true })).toEqual({
      outcome: "repeat",
      reason: "invalid-ballot",
    });
  });
  it("requires a popular majority rather than electoral-college units", () => {
    expect(decide(first)).toEqual({ outcome: "won", winnerCandidateId: "a" });
    expect(
      decide({ ...first, votesFor: { a: 30, b: 21, c: 9 }, votesAgainst: { a: 30, b: 39, c: 51 } })
    ).toEqual({ outcome: "runoff", finalistCandidateIds: ["a", "b"] });
  });
  it("accepts exactly 50 percent turnout but repeats a lower-turnout election", () => {
    expect(decide({ ...first, registeredVoters: 120 })).toEqual({
      outcome: "won",
      winnerCandidateId: "a",
    });
    expect(decide({ ...first, registeredVoters: 121 })).toEqual({
      outcome: "repeat",
      reason: "low-turnout",
    });
  });
  it("keeps blank and invalid ballots in the majority denominator", () => {
    expect(
      decide({ ...first, votesFor: { a: 29, b: 10, c: 1 }, votesAgainst: { a: 10, b: 10, c: 10 } })
    ).toEqual({ outcome: "runoff", finalistCandidateIds: ["a", "b"] });
  });
  it("requires a new runoff tally and does not award its first-round leader", () => {
    const runoff: RussianPresidentialBallot = {
      round: 2,
      candidateIds: ["a", "b"],
      votesFor: { a: 25, b: 35 },
      votesAgainst: { a: 35, b: 25 },
      registeredVoters: 100,
      participants: 60,
    };
    expect(decide(runoff)).toEqual({ outcome: "won", winnerCandidateId: "b" });
    expect(
      decide({ ...runoff, votesFor: { a: 25, b: 30 }, votesAgainst: { a: 35, b: 30 } })
    ).toEqual({ outcome: "repeat", reason: "no-runoff-winner" });
  });
  it("does not break ties by candidate id or roster order", () => {
    const tied = {
      ...first,
      votesFor: { a: 25, b: 15, c: 15 },
      votesAgainst: { a: 35, b: 45, c: 45 },
    };
    expect(decide(tied)).toEqual({ outcome: "repeat", reason: "tied-finalists" });
    expect(decide({ ...tied, candidateIds: ["c", "a", "b"] })).toEqual(decide(tied));
    expect(
      decide({
        round: 2,
        candidateIds: ["a", "b"],
        votesFor: { a: 30, b: 30 },
        votesAgainst: { a: 30, b: 30 },
        registeredVoters: 100,
        participants: 60,
      })
    ).toEqual({ outcome: "repeat", reason: "no-runoff-winner" });
  });
  it("repeats an unsuccessful first round with at most two candidates", () => {
    expect(
      decide({
        round: 1,
        candidateIds: ["a", "b"],
        votesFor: { a: 30, b: 30 },
        votesAgainst: { a: 30, b: 30 },
        registeredVoters: 100,
        participants: 60,
      })
    ).toEqual({ outcome: "repeat", reason: "no-majority" });
  });
  it.each([
    { registeredVoters: 0 },
    { participants: 101 },
    { participants: 1.5 },
    { candidateIds: ["a", "a", "b"] },
    { votesFor: { a: 40, b: 30, c: 5 } },
    { votesFor: { a: -1, b: 20, c: 9 } },
    { votesAgainst: { a: 61, b: 0, c: 0 } },
    { votesAgainst: { a: 30, b: 41, c: 52 } },
    { round: 2 },
  ])("rejects inconsistent ballot data %s", (patch) => {
    expect(() => decide({ ...first, ...patch } as RussianPresidentialBallot)).toThrow();
  });
});
