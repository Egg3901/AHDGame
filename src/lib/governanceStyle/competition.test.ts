import { describe, expect, it } from "vitest";
import { assessDemocraticCompetition } from "./competition";

describe("assessDemocraticCompetition", () => {
  it("does not punish an ordinary democratic majority", () => {
    expect(
      assessDemocraticCompetition({ seatsByParty: { dem: 213, rep: 221, independent: 1 } })
    ).toMatchObject({
      dominantPartyId: "rep",
      dominantSeatShare: 50.8,
      chambersMeasured: 1,
      penalty: 0,
    });
  });

  it("weights elected chambers equally when one party controls both", () => {
    const score = assessDemocraticCompetition({
      chambersByParty: [
        { dem: 237, farmerLabor: 165, conservative: 25, corporatist: 8 },
        { dem: 78, farmerLabor: 18 },
      ],
      executivePartyId: "dem",
      consecutiveExecutiveTerms: 2,
    });

    expect(score).toMatchObject({
      dominantPartyId: "dem",
      dominantSeatShare: 67.9,
      chambersMeasured: 2,
      executivePartyId: "dem",
      executiveAlignedWithLegislature: true,
      seatMarginPenalty: 7.7,
      executiveContinuityPenalty: 2,
      penalty: 9.7,
    });
  });

  it("keeps the competitive 1953 US Congress unpenalized", () => {
    const score = assessDemocraticCompetition({
      chambersByParty: [
        { dem: 213, rep: 221, independent: 1 },
        { dem: 47, rep: 48, independent: 1 },
      ],
    });

    expect(score).toMatchObject({
      dominantPartyId: "rep",
      dominantSeatShare: 50.4,
      chambersMeasured: 2,
      penalty: 0,
    });
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
      executivePartyId: "dem",
      consecutiveExecutiveTerms: 5,
    });
    expect(score.uninterruptedControlTurns).toBe(96);
    expect(score.seatMarginPenalty).toBe(9);
    expect(score.legislativeContinuityPenalty).toBe(6);
    expect(score.executiveContinuityPenalty).toBe(8);
    expect(score.penalty).toBe(23);
  });

  it("treats an opposition presidency as divided government", () => {
    const score = assessDemocraticCompetition({
      seatsByParty: { dem: 70, rep: 30 },
      executivePartyId: "rep",
      consecutiveExecutiveTerms: 4,
    });

    expect(score).toMatchObject({
      dominantPartyId: "dem",
      executivePartyId: "rep",
      executiveAlignedWithLegislature: false,
      seatMarginPenalty: 9,
      executiveContinuityPenalty: 0,
      penalty: 9,
    });
  });

  it("does not punish a 5-4 Supreme Court", () => {
    const score = assessDemocraticCompetition({
      seatsByParty: { dem: 218, rep: 217 },
      justicesByParty: { "1": 5, "2": 4 },
    });
    expect(score).toMatchObject({
      courtDominantPartyId: "1",
      courtDominantShare: 55.6,
      courtSeated: 9,
      courtPenalty: 0,
      penalty: 0,
    });
  });

  it("scales a packed Court from 6-3 up to a 9-0 cap", () => {
    expect(assessDemocraticCompetition({ justicesByParty: { "1": 6, "2": 3 } }).courtPenalty).toBe(
      4
    );
    expect(assessDemocraticCompetition({ justicesByParty: { "1": 7, "2": 2 } }).courtPenalty).toBe(
      10.7
    );
    expect(assessDemocraticCompetition({ justicesByParty: { "1": 8, "2": 1 } }).courtPenalty).toBe(
      17.3
    );
    expect(assessDemocraticCompetition({ justicesByParty: { "1": 9 } }).courtPenalty).toBe(24);
  });

  it("ignores vacant seats and does not score a Court with fewer than 5 justices", () => {
    const short = assessDemocraticCompetition({ justicesByParty: { "1": 4 } });
    expect(short).toMatchObject({ courtSeated: 4, courtPenalty: 0, courtDominantPartyId: null });
    const sixOne = assessDemocraticCompetition({ justicesByParty: { "1": 6, "2": 1 } });
    expect(sixOne).toMatchObject({
      courtSeated: 7,
      courtDominantShare: 85.7,
      courtPenalty: 15.4,
    });
  });

  it("adds Court packing to the existing legislative penalty", () => {
    const score = assessDemocraticCompetition({
      seatsByParty: { dem: 75, rep: 25 },
      justicesByParty: { dem: 9 },
    });
    expect(score.seatMarginPenalty).toBe(12);
    expect(score.courtPenalty).toBe(24);
    expect(score.penalty).toBe(36);
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
