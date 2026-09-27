import { describe, expect, it } from "vitest";
import { snapElectionResolutionYear } from "./snapElection";

describe("snapElectionResolutionYear", () => {
  it("uses the general-election end turn instead of the canonical cycle year", () => {
    expect(
      snapElectionResolutionYear(1228, {
        startingYear: 1953,
        preIterationTurns: 48,
      })
    ).toBe(1977);
  });

  it("keeps the calendar pinned during an active founding phase", () => {
    expect(
      snapElectionResolutionYear(400, {
        startingYear: 1953,
        preIterationActive: true,
      })
    ).toBe(1953);
  });

  it("works without a pre-iteration offset", () => {
    expect(snapElectionResolutionYear(49, { startingYear: 2019 })).toBe(2020);
  });
});
