import { describe, it, expect } from "vitest";
import { buildInitialLegislativePhases, buildUpperChamberPhase } from "../buildPhases";
import {
  LEGISLATIVE_VOTE_HOURS_PER_CHAMBER,
  LEGISLATIVE_VOTE_TURNS_PER_CHAMBER,
} from "../../constants";

describe("buildInitialLegislativePhases", () => {
  it("starts with the lower chamber for US (presidential)", () => {
    const phases = buildInitialLegislativePhases("US", 1_000, 50);
    expect(phases).toHaveLength(1);
    expect(phases[0].chamberKey).toBe("house");
    expect(phases[0].startedAtRealtimeMs).toBe(1_000);
    expect(phases[0].endsAtRealtimeMs).toBe(1_000 + LEGISLATIVE_VOTE_HOURS_PER_CHAMBER * 3_600_000);
    expect(phases[0].endsOnTurn).toBe(50 + LEGISLATIVE_VOTE_TURNS_PER_CHAMBER);
    expect(phases[0].outcome).toBe("pending");
    expect(phases[0].votesFor).toBe(0);
    expect(phases[0].votesAgainst).toBe(0);
  });

  it("starts with the lower chamber for UK (parliamentary)", () => {
    const phases = buildInitialLegislativePhases("UK", 0, 0);
    expect(phases[0].chamberKey).toBe("commons");
  });
});

describe("buildUpperChamberPhase", () => {
  it("returns an upper-chamber phase for US (senate)", () => {
    const phase = buildUpperChamberPhase("US", 5_000, 50);
    expect(phase).not.toBeNull();
    expect(phase!.chamberKey).toBe("senate");
    expect(phase!.startedAtRealtimeMs).toBe(5_000);
    expect(phase!.endsOnTurn).toBe(50 + LEGISLATIVE_VOTE_TURNS_PER_CHAMBER);
    expect(phase!.outcome).toBe("pending");
  });
});
