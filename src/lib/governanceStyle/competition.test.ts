import { describe, expect, it } from "vitest";
import { assessDemocraticCompetition } from "./competition";

describe("assessDemocraticCompetition", () => {
  it("does not punish an ordinary democratic majority", () => {
    expect(
      assessDemocraticCompetition({ seatsByParty: { dem: 213, rep: 221, independent: 1 } })
    ).toMatchObject({ dominantPartyId: "rep", dominantSeatShare: 50.8, penalty: 0 });
  });

  it("penalizes a lopsided chamber", () => {
    const score = assessDemocraticCompetition({ seatsByParty: { dem: 75, rep: 25 } });
    expect(score.dominantSeatShare).toBe(75);
    expect(score.penalty).toBe(12);
  });

  it("adds pressure for uninterrupted control and repeated executive terms", () => {
    const history = Array.from({ length: 96 }, (_, index) => [
      { turn: index + 1, party: "dem", seats: 70 },
      { turn: index + 1, party: "rep", seats: 30 },
    ]).flat();
    const score = assessDemocraticCompetition({
      seatsByParty: { dem: 70, rep: 30 },
      history,
      consecutiveExecutiveTerms: 5,
    });
    expect(score.uninterruptedControlTurns).toBe(96);
    expect(score.penalty).toBe(27);
  });

  it("stops the control streak at the last alternation", () => {
    const score = assessDemocraticCompetition({
      seatsByParty: { dem: 60, rep: 40 },
      history: [
        { turn: 1, party: "rep", seats: 60 },
        { turn: 1, party: "dem", seats: 40 },
        { turn: 2, party: "dem", seats: 60 },
        { turn: 2, party: "rep", seats: 40 },
      ],
    });
    expect(score.uninterruptedControlTurns).toBe(1);
  });
});
