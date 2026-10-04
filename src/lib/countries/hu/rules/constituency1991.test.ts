import { describe, expect, it } from "vitest";
import { countHu1991Constituency, type Hu1991ConstituencyRound } from "./constituency1991";

function round(
  votes: number[],
  ballotsCast = votes.reduce((a, b) => a + b, 0)
): Hu1991ConstituencyRound {
  return {
    registeredVoters: 1000,
    ballotsCast,
    candidates: votes.map((votes, index) => ({
      candidateId: `person-${index}`,
      partyId: `party-${index}`,
      votes,
    })),
  };
}

describe("Hungarian 1991 constituency rounds", () => {
  it("requires strict majority and turnout before electing in round one", () => {
    expect(countHu1991Constituency(round([301, 299]))).toMatchObject({
      kind: "elected",
      winnerId: "person-0",
      compensationVotes: { "party-1": 299 },
    });
    expect(countHu1991Constituency(round([300, 300]))).toMatchObject({ kind: "runoff" });
    expect(countHu1991Constituency(round([400, 100]))).toMatchObject({
      kind: "runoff",
      firstRoundValid: false,
    });
  });
  it("retains all contestants when the first turnout is invalid", () => {
    expect(countHu1991Constituency(round([350, 75, 50, 25]))).toMatchObject({
      kind: "runoff",
      candidateIds: ["person-0", "person-1", "person-2", "person-3"],
    });
  });
  it("admits all candidates at 15 percent and uses top three when fewer qualify", () => {
    expect(countHu1991Constituency(round([240, 180, 90, 90]))).toMatchObject({
      kind: "runoff",
      candidateIds: ["person-0", "person-1", "person-2", "person-3"],
    });
    expect(countHu1991Constituency(round([290, 250, 40, 20]))).toMatchObject({
      kind: "runoff",
      candidateIds: ["person-0", "person-1", "person-2"],
    });
  });
  it("counts first-round losers once and never credits the winner's surplus", () => {
    const result = countHu1991Constituency(round([290, 250, 40, 20]), round([140, 180, 10]));
    expect(result).toEqual({
      kind: "elected",
      winnerId: "person-1",
      winnerParty: "party-1",
      compensationVotes: { "party-0": 290, "party-2": 40, "party-3": 20 },
    });
  });
  it("counts the valid second round after invalid first turnout", () => {
    expect(countHu1991Constituency(round([300, 100]), round([160, 100]))).toMatchObject({
      kind: "elected",
      winnerId: "person-0",
      compensationVotes: { "party-1": 100 },
    });
  });
  it("leaves tied or invalid second rounds vacant for a by-election", () => {
    expect(countHu1991Constituency(round([300, 300]), round([125, 125]))).toMatchObject({
      kind: "vacant",
      reason: "invalid-turnout",
    });
    expect(countHu1991Constituency(round([300, 300]), round([150, 150]))).toMatchObject({
      kind: "vacant",
      reason: "tied-plurality",
      winnerId: null,
    });
  });
  it("does not compensate independent losers", () => {
    const first = round([400, 200]);
    first.candidates = [first.candidates[0], { ...first.candidates[1], partyId: "independent" }];
    expect(countHu1991Constituency(first)).toMatchObject({
      kind: "elected",
      compensationVotes: {},
    });
  });
  it("rejects new runoff nominees, altered electorate and inflated ballot totals", () => {
    expect(() =>
      countHu1991Constituency(round([290, 250, 40, 20]), round([140, 100, 30, 20]))
    ).toThrow(/unqualified/);
    expect(() =>
      countHu1991Constituency(round([300, 300]), { ...round([150, 160]), registeredVoters: 2000 })
    ).toThrow(/electorate/);
    expect(() => countHu1991Constituency(round([700, 400]))).toThrow(/turnout/);
  });
});
