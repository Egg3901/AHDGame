import { describe, expect, it } from "vitest";
import { nppVacateMotionVote, nppVacateStanceCloseness } from "./nppVacateVote";

const MAJOR = new Set(["1", "2"]);
const centre = { economic: 0, social: 0 };
const farRight = { economic: 5, social: 5 };

/** rng that always picks the first branch of a coin flip. */
const alwaysLow = () => 0;
/** rng that always picks the second branch of a coin flip. */
const alwaysHigh = () => 0.99;

describe("nppVacateStanceCloseness", () => {
  it("is true only when both axes sit inside the distance", () => {
    expect(nppVacateStanceCloseness(centre, { economic: 2, social: 2 })).toBe(true);
    expect(nppVacateStanceCloseness(centre, { economic: 2, social: 3 })).toBe(false);
  });

  it("reports no signal when either stance is missing", () => {
    expect(nppVacateStanceCloseness(undefined, centre)).toBeNull();
    expect(nppVacateStanceCloseness(centre, undefined)).toBeNull();
  });

  it("reports no signal on a non-finite axis rather than treating it as close", () => {
    expect(nppVacateStanceCloseness(centre, { economic: Number.NaN, social: 0 })).toBeNull();
  });
});

describe("nppVacateMotionVote", () => {
  it("keeps the chair when the bloc has no party", () => {
    expect(
      nppVacateMotionVote({
        nppParty: undefined,
        nppStance: centre,
        speakerParty: "1",
        speakerStance: farRight,
        majorPartyIds: MAJOR,
        rng: alwaysLow,
      })
    ).toBe("against");
  });

  it("defends a Speaker of its own party even at maximum ideological distance", () => {
    expect(
      nppVacateMotionVote({
        nppParty: "1",
        nppStance: centre,
        speakerParty: "1",
        speakerStance: farRight,
        majorPartyIds: MAJOR,
        rng: alwaysLow,
      })
    ).toBe("against");
  });

  it("moves to vacate an opposing Major-party Speaker", () => {
    expect(
      nppVacateMotionVote({
        nppParty: "2",
        nppStance: centre,
        speakerParty: "1",
        speakerStance: farRight,
        majorPartyIds: MAJOR,
        rng: alwaysLow,
      })
    ).toBe("for");
  });

  it("is genuinely uncertain when both are Major but ideologically close", () => {
    const input = {
      nppParty: "2",
      nppStance: centre,
      speakerParty: "1",
      speakerStance: centre,
      majorPartyIds: MAJOR,
    };
    expect(nppVacateMotionVote({ ...input, rng: alwaysLow })).toBe("for");
    expect(nppVacateMotionVote({ ...input, rng: alwaysHigh })).toBe("against");
  });

  it("keeps the chair for a minor party with no usable ideology signal", () => {
    expect(
      nppVacateMotionVote({
        nppParty: "9",
        nppStance: undefined,
        speakerParty: "1",
        speakerStance: farRight,
        majorPartyIds: MAJOR,
        rng: alwaysLow,
      })
    ).toBe("against");
  });

  it("lets a distant minor party move to vacate on a coin flip", () => {
    const input = {
      nppParty: "9",
      nppStance: centre,
      speakerParty: "1",
      speakerStance: farRight,
      majorPartyIds: MAJOR,
    };
    expect(nppVacateMotionVote({ ...input, rng: alwaysLow })).toBe("for");
    expect(nppVacateMotionVote({ ...input, rng: alwaysHigh })).toBe("against");
  });

  it("keeps the chair when the Speaker's party is unknown and stances are close", () => {
    expect(
      nppVacateMotionVote({
        nppParty: "2",
        nppStance: centre,
        speakerParty: undefined,
        speakerStance: centre,
        majorPartyIds: MAJOR,
        rng: alwaysLow,
      })
    ).toBe("against");
  });
});
