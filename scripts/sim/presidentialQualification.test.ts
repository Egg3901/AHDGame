import { describe, expect, it } from "vitest";
import { qualifyPresidentialRace } from "./presidentialQualification";

const snapshot = {
  candidates: [
    { id: "a", party: "1", isNPP: false, totalVotes: 60, electoralVotes: 3 },
    { id: "b", party: "2", isNPP: true, totalVotes: 40, electoralVotes: 2 },
  ],
  units: [
    {
      id: "AA",
      weight: 3,
      candidates: [
        { candidateId: "a", votes: 40 },
        { candidateId: "b", votes: 10 },
      ],
    },
    {
      id: "BB",
      weight: 2,
      candidates: [
        { candidateId: "a", votes: 20 },
        { candidateId: "b", votes: 30 },
      ],
    },
  ],
  totalEv: 5,
  evNeeded: 3,
  summary: { totalVotes: 100 },
};
const tally = {
  totalVotes: { a: 60, b: 40 },
  totalVotesByUnit: { AA: { a: 40, b: 10 }, BB: { a: 20, b: 30 } },
  electoralVotesByCandidate: { a: 3, b: 2 },
  resolutionMode: "majority" as const,
};

describe("qualifyPresidentialRace", () => {
  it("reconciles votes and election-time EV without a present-day apportionment map", () => {
    expect(qualifyPresidentialRace("race", snapshot, tally)).toEqual({
      electionId: "race",
      popularMarginPct: 20,
      evMargin: 1,
      winnerId: "a",
      winnerParty: "1",
      winnerIsNPP: false,
      contingent: false,
      reconciliation: [],
    });
  });

  it("uses the contingent winner even when the EV plurality differs", () => {
    const result = qualifyPresidentialRace("race", snapshot, {
      ...tally,
      resolutionMode: "contingent",
      contingentResult: { presidentWinnerId: "b" },
    });
    expect(result.winnerId).toBe("b");
    expect(result.winnerIsNPP).toBe(true);
    expect(result.contingent).toBe(true);
  });

  it("reports missing snapshots and per-unit drift explicitly", () => {
    expect(qualifyPresidentialRace("race", null, tally).reconciliation).toContain(
      "missing election-time result snapshot"
    );
    expect(
      qualifyPresidentialRace("race", snapshot, {
        ...tally,
        totalVotesByUnit: { ...tally.totalVotesByUnit, AA: { a: 39, b: 10 } },
      }).reconciliation
    ).toContain("unit votes differ for AA/a");
  });
});
