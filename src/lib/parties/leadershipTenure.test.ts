import { describe, it, expect } from "vitest";
import { PARTY_LEADERSHIP_TENURE_TURNS, getPartyTenure } from "@/lib/parties/leadershipTenure";

describe("getPartyTenure", () => {
  it("exposes a 24-turn requirement", () => {
    expect(PARTY_LEADERSHIP_TENURE_TURNS).toBe(24);
  });

  it("grandfathers a missing partyJoinedTurn (null/undefined) as eligible", () => {
    expect(getPartyTenure(null, 100)).toEqual({
      turnsServed: Number.POSITIVE_INFINITY,
      eligible: true,
      turnsRemaining: 0,
    });
    expect(getPartyTenure(undefined, 100).eligible).toBe(true);
  });

  it("blocks a member who just joined this turn", () => {
    expect(getPartyTenure(100, 100)).toEqual({
      turnsServed: 0,
      eligible: false,
      turnsRemaining: 24,
    });
  });

  it("blocks one turn short of the threshold", () => {
    expect(getPartyTenure(100, 123)).toEqual({
      turnsServed: 23,
      eligible: false,
      turnsRemaining: 1,
    });
  });

  it("allows exactly at the threshold", () => {
    expect(getPartyTenure(100, 124)).toEqual({
      turnsServed: 24,
      eligible: true,
      turnsRemaining: 0,
    });
  });

  it("allows well past the threshold", () => {
    expect(getPartyTenure(100, 200).eligible).toBe(true);
  });

  it("clamps negative deltas to zero turns served (clock skew safety)", () => {
    expect(getPartyTenure(150, 100)).toEqual({
      turnsServed: 0,
      eligible: false,
      turnsRemaining: 24,
    });
  });

  it("honors a custom requiredTurns override", () => {
    expect(getPartyTenure(100, 110, 5).eligible).toBe(true);
    expect(getPartyTenure(100, 103, 5)).toEqual({
      turnsServed: 3,
      eligible: false,
      turnsRemaining: 2,
    });
  });
});
