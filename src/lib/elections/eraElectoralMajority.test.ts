import { ObjectId } from "mongodb";
import { describe, expect, it } from "vitest";
import {
  electoralMajorityFor,
  collegeSizeFromEvByState,
  PRESIDENTIAL_EV_NEEDED,
} from "./presidentialResolutionDisplay";
import { determinePresidentialWinner } from "@/lib/turn/electionCalculations";
import {
  contingentMajorityOf,
  HOUSE_CONTINGENT_THRESHOLD,
  SENATE_CONTINGENT_THRESHOLD,
  resolveContingentElection,
  type ContingentHouseDelegation,
  type ContingentVoterProfile,
} from "./contingentElection";

describe("era-aware electoral majorities", () => {
  it("reproduces the modern constants exactly (golden gate)", () => {
    expect(electoralMajorityFor(538)).toBe(270);
    expect(contingentMajorityOf(50, HOUSE_CONTINGENT_THRESHOLD)).toBe(26);
    expect(contingentMajorityOf(100, SENATE_CONTINGENT_THRESHOLD)).toBe(51);
  });

  it("yields the era-correct thresholds for the 1950s roster", () => {
    // 48 states, no DC electors, no ME/NE splits: 531 electors, 266 to win;
    // 48 delegations -> 25; 96 senators -> 49.
    expect(electoralMajorityFor(531)).toBe(266);
    expect(contingentMajorityOf(48, HOUSE_CONTINGENT_THRESHOLD)).toBe(25);
    expect(contingentMajorityOf(96, SENATE_CONTINGENT_THRESHOLD)).toBe(49);
  });

  it("falls back to the modern constants on missing rosters", () => {
    expect(electoralMajorityFor(0)).toBe(PRESIDENTIAL_EV_NEEDED);
    expect(electoralMajorityFor(NaN)).toBe(PRESIDENTIAL_EV_NEEDED);
    expect(contingentMajorityOf(0, HOUSE_CONTINGENT_THRESHOLD)).toBe(26);
  });

  it("sums a college from evByState and tolerates absence", () => {
    expect(collegeSizeFromEvByState({ A: 500, B: 31 })).toBe(531);
    expect(collegeSizeFromEvByState(undefined)).toBe(0);
    expect(collegeSizeFromEvByState({})).toBe(0);
  });

  it("a 266-269 EV winner on a 531 college wins outright, not contingent", () => {
    // The exact failure the hardcoded 270 caused on era worlds: 267 of 531 is
    // an outright majority but sat below the modern constant.
    const votes = { winner: 267, loser: 264 };
    expect(determinePresidentialWinner(votes)).toBeNull(); // old behavior via default
    expect(determinePresidentialWinner(votes, electoralMajorityFor(531))).toEqual({
      winnerId: "winner",
      winnerEV: 267,
    });
  });

  it("resolveContingentElection stores roster-derived thresholds", () => {
    const candA = "a".repeat(24);
    const candB = "b".repeat(24);
    // A 4-delegation mini-roster: majority is 3, not the modern 26.
    const delegations: ContingentHouseDelegation[] = ["S1", "S2", "S3", "S4"].map((stateId) => ({
      stateId,
      voters: [{ id: new ObjectId().toString(), partyId: "p1", isNPP: true }],
    })) as unknown as ContingentHouseDelegation[];
    const senators: ContingentVoterProfile[] = [];
    const result = resolveContingentElection({
      electionId: new ObjectId(),
      electoralVotesByCandidate: { [candA]: 260, [candB]: 271 },
      presidentCandidates: [
        { id: candA, partyId: "p1", isNPP: true },
        { id: candB, partyId: "p2", isNPP: true },
      ] as never,
      vicePresidentCandidates: [] as never,
      houseDelegations: delegations,
      senators,
    } as never);
    expect(result.houseThreshold).toBe(3);
    // Empty senate roster falls back to the modern constant.
    expect(result.senateThreshold).toBe(SENATE_CONTINGENT_THRESHOLD);
  });
});
