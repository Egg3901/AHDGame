import { describe, it, expect } from "vitest";
import {
  nextPresidentialTenure,
  getPresidentialConsecutiveTerms,
} from "./presidentialTenureLedger";

describe("nextPresidentialTenure", () => {
  it("starts a fresh 1-term streak on first-ever record", () => {
    expect(nextPresidentialTenure(undefined, "dem")).toEqual({ party: "dem", consecutiveTerms: 1 });
  });

  it("extends the streak when the same party wins again", () => {
    expect(nextPresidentialTenure({ party: "dem", consecutiveTerms: 2 }, "dem")).toEqual({
      party: "dem",
      consecutiveTerms: 3,
    });
  });

  it("resets to 1 when a different party wins", () => {
    expect(nextPresidentialTenure({ party: "dem", consecutiveTerms: 3 }, "rep")).toEqual({
      party: "rep",
      consecutiveTerms: 1,
    });
  });

  it("leaves the ledger untouched when the winning party is missing", () => {
    expect(nextPresidentialTenure({ party: "dem", consecutiveTerms: 3 }, null)).toEqual({
      party: "dem",
      consecutiveTerms: 3,
    });
  });
});

describe("getPresidentialConsecutiveTerms", () => {
  const gs = {
    presidentialTenureByCountry: { US: { party: "dem", consecutiveTerms: 3 } },
  } as const;

  it("returns the streak when the stored party matches the incumbent", () => {
    expect(getPresidentialConsecutiveTerms(gs, "US", "dem")).toBe(3);
  });

  it("returns 0 when the stored party differs (tracks someone else's streak)", () => {
    expect(getPresidentialConsecutiveTerms(gs, "US", "rep")).toBe(0);
  });

  it("returns 0 for a missing country entry, missing state, or missing incumbent", () => {
    expect(getPresidentialConsecutiveTerms(gs, "UK", "lab")).toBe(0);
    expect(getPresidentialConsecutiveTerms(null, "US", "dem")).toBe(0);
    expect(getPresidentialConsecutiveTerms(gs, "US", undefined)).toBe(0);
  });
});
