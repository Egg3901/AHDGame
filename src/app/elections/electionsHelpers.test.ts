import { describe, expect, it } from "vitest";
import type { ElectionDisplay } from "@/lib/db/types";
import { isCompetitiveElection } from "./electionsHelpers";

function race(inPrimary: boolean, sharesPct: Record<string, number>): ElectionDisplay {
  return {
    id: "race-1",
    electionType: "senate",
    state: "UT",
    countryId: "US",
    cycle: 1,
    status: "active",
    candidates: [],
    inPrimary,
    polling: {
      leaderId: null,
      leaderName: null,
      leaderParty: null,
      sharesPct,
      candidateNames: {},
      candidateParties: {},
      source: inPrimary ? "primary" : "general",
    },
  };
}

describe("isCompetitiveElection", () => {
  it("does not compare separately normalized party primary shares", () => {
    expect(isCompetitiveElection(race(true, { democrat: 100, republican: 100 }))).toBe(false);
  });

  it("keeps the close badge for general elections within 15 points", () => {
    expect(isCompetitiveElection(race(false, { first: 53, second: 47 }))).toBe(true);
    expect(isCompetitiveElection(race(false, { first: 80, second: 20 }))).toBe(false);
  });
});
