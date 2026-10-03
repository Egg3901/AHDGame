import { describe, it, expect } from "vitest";
import { countHu1991ByElection, type Hu1991ByElectionBallot } from "./constituencyByElection1991";
const id = "HU-constituency-01-01";
function ballot(): Hu1991ByElectionBallot {
  return {
    id,
    first: {
      registeredVoters: 1000,
      ballotsCast: 600,
      candidates: [
        { candidateId: "A", partyId: "A", votes: 400 },
        { candidateId: "B", partyId: "B", votes: 200 },
      ],
    },
  };
}
describe("Hungarian individual constituency by-elections", () => {
  it("fills only a frozen vacant constituency", () => {
    expect(countHu1991ByElection([id], [ballot()])).toEqual({
      kind: "counted",
      winners: { [id]: "A" },
      vacancies: [],
    });
  });
  it("requires a genuine qualified runoff after a tied valid first round", () => {
    const input = ballot();
    input.first.candidates = input.first.candidates.map((row) => ({ ...row, votes: 300 }));
    expect(countHu1991ByElection([id], [input])).toEqual({
      kind: "pending",
      runoffs: { [id]: ["A", "B"] },
    });
    input.second = {
      registeredVoters: 1000,
      ballotsCast: 300,
      candidates: input.first.candidates.map((row) => ({
        ...row,
        votes: row.candidateId === "B" ? 180 : 120,
      })),
    };
    expect(countHu1991ByElection([id], [input])).toEqual({
      kind: "counted",
      winners: { [id]: "B" },
      vacancies: [],
    });
  });
  it("keeps a failed second-round seat vacant without a compensation allocation", () => {
    const input = ballot();
    input.first = {
      ...input.first,
      ballotsCast: 0,
      candidates: input.first.candidates.map((row) => ({ ...row, votes: 0 })),
    };
    input.second = input.first;
    const result = countHu1991ByElection([id], [input]);
    expect(result).toEqual({ kind: "counted", winners: { [id]: null }, vacancies: [id] });
    expect(result).not.toHaveProperty("compensationVotes");
  });
  it("rejects occupied, repeated, missing or foreign constituency identities", () => {
    expect(() =>
      countHu1991ByElection([id], [{ ...ballot(), id: "HU-constituency-01-02" }])
    ).toThrow(/vacant/);
    expect(() => countHu1991ByElection([id, id], [ballot(), ballot()])).toThrow(/vacant/);
    expect(() => countHu1991ByElection([id], [])).toThrow(/vacant/);
    expect(() => countHu1991ByElection(["foreign"], [{ ...ballot(), id: "foreign" }])).toThrow(
      /vacant/
    );
  });
});
