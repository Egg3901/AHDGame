import { describe, expect, it } from "vitest";
import {
  resolveRussianDumaConstituency as constituency,
  resolveRussianDumaList as list,
} from "./assemblyResult";
const option = (id: string, votes: number, registrationOrder = 0) => ({
  id,
  votes,
  registrationOrder,
});
describe("First Duma certified ballot rules", () => {
  it("keeps the parallel list tier at 225 and excludes sub-threshold parties", () => {
    expect(
      list({
        registeredVoters: 2000,
        againstAllVotes: 0,
        options: [option("a", 570), option("b", 280), option("c", 150), option("tiny", 1)],
      })
    ).toEqual({
      outcome: "elected",
      validBallots: 1001,
      partySeats: { a: 128, b: 63, c: 34, tiny: 0 },
    });
  });
  it("admits exactly five percent and includes against-all ballots in the threshold", () => {
    const result = list({
      registeredVoters: 1000,
      againstAllVotes: 100,
      options: [option("a", 849), option("exact", 50), option("below", 1)],
    });
    expect(result.outcome).toBe("elected");
    if (result.outcome !== "elected") throw new Error("Expected certified list");
    expect(result.partySeats.exact).toBeGreaterThan(0);
    expect(result.partySeats.below).toBe(0);
    expect(Object.values(result.partySeats).reduce((sum, seats) => sum + seats, 0)).toBe(225);
  });
  it("uses votes for eligible lists as the quota denominator", () => {
    expect(
      list({
        registeredVoters: 1000,
        againstAllVotes: 499,
        options: [option("a", 500), option("below", 1)],
      })
    ).toMatchObject({ outcome: "elected", partySeats: { a: 225, below: 0 } });
  });
  it("breaks equal remainders by total votes, then earlier registration", () => {
    expect(
      list({
        registeredVoters: 6,
        againstAllVotes: 0,
        options: [option("small", 1, 0), option("large", 3, 1), option("other", 2, 2)],
      })
    ).toMatchObject({ partySeats: { small: 37, large: 113, other: 75 } });
    expect(
      list({
        registeredVoters: 2,
        againstAllVotes: 0,
        options: [option("late", 1, 1), option("early", 1, 0)],
      })
    ).toMatchObject({ partySeats: { late: 112, early: 113 } });
  });
  it.each([list, constituency])("accepts the exact 25-percent valid-ballot quorum", (resolve) => {
    expect(
      resolve({ registeredVoters: 100, againstAllVotes: 0, options: [option("a", 25)] }).outcome
    ).toBe("elected");
    expect(
      resolve({ registeredVoters: 101, againstAllVotes: 0, options: [option("a", 25)] })
    ).toMatchObject({ outcome: "repeat", reason: "low-valid-turnout" });
  });
  it("repeats when all lists fall below five percent without a ranked fallback", () => {
    expect(
      list({
        registeredVoters: 100,
        againstAllVotes: 90,
        options: [option("a", 4), option("b", 4), option("c", 2)],
      })
    ).toMatchObject({ outcome: "repeat", reason: "no-eligible-list" });
  });
  it("uses earlier candidate registration to settle a constituency tie", () => {
    expect(
      constituency({
        registeredVoters: 100,
        againstAllVotes: 0,
        options: [option("late", 20, 2), option("early", 20, 1)],
      })
    ).toMatchObject({ outcome: "elected", winnerId: "early" });
  });
  it("does not revive the superseded against-all constituency veto", () => {
    expect(
      constituency({ registeredVoters: 100, againstAllVotes: 22, options: [option("a", 3)] })
    ).toEqual({ outcome: "elected", validBallots: 25, winnerId: "a" });
  });
  it("repeats empty and invalidated ballots", () => {
    expect(constituency({ registeredVoters: 100, againstAllVotes: 25, options: [] })).toMatchObject(
      { reason: "no-candidate-votes" }
    );
    expect(
      list({
        registeredVoters: 100,
        againstAllVotes: 0,
        options: [option("a", 100)],
        invalidated: true,
      })
    ).toMatchObject({ reason: "invalidated" });
  });
  it("rejects bad counts, duplicate choices and turnout above registration", () => {
    expect(() =>
      list({ registeredVoters: 100, againstAllVotes: 0, options: [option("a", 101)] })
    ).toThrow("register");
    expect(() =>
      list({ registeredVoters: 100, againstAllVotes: 0, options: [option("a", 1), option("a", 1)] })
    ).toThrow("unique");
    expect(() => constituency({ registeredVoters: 100, againstAllVotes: -1, options: [] })).toThrow(
      "safe"
    );
  });
  it("preserves exact seat totals near the safe integer voter limit", () => {
    const registeredVoters = Number.MAX_SAFE_INTEGER;
    const result = list({
      registeredVoters,
      againstAllVotes: 1,
      options: [option("a", 4503599627370495), option("b", 4503599627370495)],
    });
    expect(result).toMatchObject({ outcome: "elected", partySeats: { a: 113, b: 112 } });
  });
});
