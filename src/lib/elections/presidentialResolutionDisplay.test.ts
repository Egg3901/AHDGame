import { describe, it, expect } from "vitest";
import {
  assessContingentEvRisk,
  isContingentResolutionMode,
  resolvePresidentialWinnerCandidateId,
} from "./presidentialResolutionDisplay";

describe("presidentialResolutionDisplay", () => {
  it("detects contingent resolution modes", () => {
    expect(isContingentResolutionMode("contingent")).toBe(true);
    expect(isContingentResolutionMode("contingent_deadlock")).toBe(true);
    expect(isContingentResolutionMode("majority")).toBe(false);
    expect(isContingentResolutionMode(undefined)).toBe(false);
  });

  it("uses EV majority winner when resolutionMode is majority", () => {
    expect(resolvePresidentialWinnerCandidateId({ a: 300, b: 238 }, "majority", undefined)).toBe(
      "a"
    );
  });

  it("returns null when no EV majority and mode is majority", () => {
    expect(
      resolvePresidentialWinnerCandidateId({ a: 269, b: 269 }, "majority", undefined)
    ).toBeNull();
  });

  it("flags live EV projections below 270 as contingent risk", () => {
    expect(assessContingentEvRisk({ a: 260, b: 240 })?.atRisk).toBe(true);
    expect(assessContingentEvRisk({ a: 300, b: 238 })?.atRisk).toBe(false);
  });

  it("uses contingent presidentWinnerId when resolution is contingent", () => {
    expect(
      resolvePresidentialWinnerCandidateId({ a: 269, b: 269, c: 0 }, "contingent", {
        eligiblePresidentCandidateIds: ["a", "b", "c"],
        eligibleVicePresidentCandidateIds: [],
        houseDelegationVotes: { TX: "b" },
        houseVoteTotals: { a: 10, b: 16, c: 0 },
        senateVotes: {},
        senateVoteTotals: {},
        presidentWinnerId: "b",
        vicePresidentWinnerId: null,
        houseThreshold: 26,
        senateThreshold: 51,
        topElectoralVoteTotal: 269,
      })
    ).toBe("b");
  });
});
