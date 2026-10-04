import { describe, expect, it } from "vitest";
import {
  resolveBgFoundingFirstRound as first,
  resolveBgFoundingRunoff as second,
  type BgFoundingMajorityBallot,
} from "./foundingMajority1990";

const ballot: BgFoundingMajorityBallot = {
  registeredVoters: 1000,
  ballotsCast: 600,
  invalidBallots: 0,
  options: [
    { personId: "a", votes: 350, tieOrder: 1 },
    { personId: "b", votes: 200, tieOrder: 2 },
    { personId: "c", votes: 50, tieOrder: 3 },
  ],
};
describe("Bulgarian founding majority ballots", () => {
  it("requires more than half of both the register and valid votes", () => {
    expect(first(ballot)).toEqual({ kind: "elected", personId: "a" });
    expect(
      first({ ...ballot, ballotsCast: 500, options: [{ personId: "a", votes: 500, tieOrder: 1 }] })
    ).toMatchObject({ kind: "runoff", allowNewNominations: true });
    expect(
      first({
        ...ballot,
        options: [
          { personId: "a", votes: 300, tieOrder: 1 },
          { personId: "b", votes: 300, tieOrder: 2 },
        ],
      })
    ).toMatchObject({ kind: "runoff" });
  });
  it("counts invalid ballots for participation, but excludes them from the majority denominator", () => {
    expect(
      first({
        ...ballot,
        invalidBallots: 300,
        options: [
          { personId: "a", votes: 151, tieOrder: 1 },
          { personId: "b", votes: 149, tieOrder: 2 },
        ],
      })
    ).toEqual({ kind: "elected", personId: "a" });
  });
  it("uses a genuine new top-two ballot without a second turnout quorum", () => {
    const initial = { ...ballot, registeredVoters: 2000 };
    expect(
      second(initial, {
        ...initial,
        ballotsCast: 1,
        options: [
          { personId: "a", votes: 0, tieOrder: 1 },
          { personId: "b", votes: 1, tieOrder: 2 },
        ],
      })
    ).toEqual({ kind: "elected", personId: "b" });
    expect(() => second(initial, { ...ballot, registeredVoters: 2000 })).toThrow("unqualified");
  });
  it("permits a new nominee when the unsuccessful first ballot had one candidate", () => {
    const initial = {
      ...ballot,
      ballotsCast: 400,
      options: [{ personId: "a", votes: 400, tieOrder: 1 }],
    };
    expect(
      second(initial, {
        ...ballot,
        ballotsCast: 10,
        options: [{ personId: "new", votes: 10, tieOrder: 2 }],
      })
    ).toEqual({ kind: "elected", personId: "new" });
  });
  it("retains frozen tie order and rejects changed registers or already won seats", () => {
    const initial = { ...ballot, registeredVoters: 2000 };
    const tied = {
      ...initial,
      ballotsCast: 2,
      options: [
        { personId: "a", votes: 1, tieOrder: 1 },
        { personId: "b", votes: 1, tieOrder: 2 },
      ],
    };
    expect(second(initial, tied)).toEqual({ kind: "elected", personId: "a" });
    expect(() => second(initial, { ...tied, registeredVoters: 2001 })).toThrow("register");
    expect(() =>
      second(initial, {
        ...tied,
        options: [{ ...tied.options[0]!, tieOrder: 3 }, tied.options[1]!],
      })
    ).toThrow("tie order");
    expect(() => second(ballot, tied)).toThrow("no pending");
  });
  it("zero-vote second ballots require another poll", () => {
    const initial = { ...ballot, registeredVoters: 2000 };
    expect(second(initial, { ...initial, ballotsCast: 0, options: [] })).toEqual({
      kind: "repeat",
      reason: "no-votes",
    });
  });
  it("rejects duplicate actors, duplicate tie ranks and false ballot totals", () => {
    expect(() => first({ ...ballot, ballotsCast: 601 })).toThrow("accounting");
    expect(() => first({ ...ballot, options: [ballot.options[0], ballot.options[0]] })).toThrow(
      "Invalid"
    );
    expect(() => first({ ...ballot, invalidBallots: -1 })).toThrow("Invalid");
  });
});
