import { describe, expect, it } from "vitest";
import { DEFAULT_VOTING_AGE, resolveVotingAgeEligible } from "./votingAge";

describe("votingAge", () => {
  it("defaults to 18", () => {
    expect(DEFAULT_VOTING_AGE).toBe(18);
    expect(resolveVotingAgeEligible(undefined)).toBe(18);
    expect(resolveVotingAgeEligible({})).toBe(18);
  });
  it("honors a stored override (future-law hook), clamped to a sane range", () => {
    expect(resolveVotingAgeEligible({ votingAgeEligible: 16 })).toBe(16);
    expect(resolveVotingAgeEligible({ votingAgeEligible: 21 })).toBe(21);
    expect(resolveVotingAgeEligible({ votingAgeEligible: 5 })).toBe(16); // floor
    expect(resolveVotingAgeEligible({ votingAgeEligible: 40 })).toBe(25); // ceil
  });
  it("ignores non-finite overrides", () => {
    expect(resolveVotingAgeEligible({ votingAgeEligible: NaN })).toBe(18);
    expect(resolveVotingAgeEligible({ votingAgeEligible: undefined })).toBe(18);
  });
});

describe("the 26th Amendment", () => {
  it("uses 21 before 1971 and 18 from 1971", () => {
    expect(resolveVotingAgeEligible(undefined, 1953)).toBe(21);
    expect(resolveVotingAgeEligible(undefined, 1970)).toBe(21);
    expect(resolveVotingAgeEligible(undefined, 1971)).toBe(18);
    expect(resolveVotingAgeEligible(undefined, 2019)).toBe(18);
  });

  it("keeps the flat modern default when the world has no clock", () => {
    expect(resolveVotingAgeEligible(undefined, null)).toBe(DEFAULT_VOTING_AGE);
    expect(resolveVotingAgeEligible(undefined, undefined)).toBe(DEFAULT_VOTING_AGE);
  });

  it("lets legislation beat the year in BOTH directions", () => {
    // A world that enfranchises 18-year-olds early must not be dragged back to
    // 21 by its date — that is the whole point of the stored override, and it
    // is what keeps this gravity rather than a rail.
    expect(resolveVotingAgeEligible({ votingAgeEligible: 18 }, 1953)).toBe(18);
    // And a modern world that raises it is honoured too.
    expect(resolveVotingAgeEligible({ votingAgeEligible: 21 }, 2019)).toBe(21);
  });

  it("clamps a stored override regardless of year", () => {
    expect(resolveVotingAgeEligible({ votingAgeEligible: 99 }, 1953)).toBe(25);
    expect(resolveVotingAgeEligible({ votingAgeEligible: 1 }, 1953)).toBe(16);
  });
});
