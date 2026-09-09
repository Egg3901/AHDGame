import { describe, it, expect } from "vitest";
import {
  PARTY_LEADERSHIP_TENURE_TURNS,
  getLeadershipEligibility,
  getPartyTenure,
} from "@/lib/parties/leadershipTenure";

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

describe("getLeadershipEligibility", () => {
  it("exempts a founder of this party who joined this very turn", () => {
    expect(
      getLeadershipEligibility({ partyJoinedTurn: 100, foundedPartyId: "7" }, 100, "7")
    ).toEqual({
      turnsServed: Number.POSITIVE_INFINITY,
      eligible: true,
      turnsRemaining: 0,
    });
  });

  it("accepts a numeric partyId, matching the stored string marker", () => {
    expect(
      getLeadershipEligibility({ partyJoinedTurn: 100, foundedPartyId: "7" }, 100, 7).eligible
    ).toBe(true);
  });

  it("does not exempt a founder in a party they did not found", () => {
    expect(
      getLeadershipEligibility({ partyJoinedTurn: 100, foundedPartyId: "7" }, 100, "8")
    ).toEqual({
      turnsServed: 0,
      eligible: false,
      turnsRemaining: 24,
    });
  });

  it("falls back to the tenure clock when there is no founder marker", () => {
    expect(getLeadershipEligibility({ partyJoinedTurn: 100 }, 110, "7")).toEqual({
      turnsServed: 10,
      eligible: false,
      turnsRemaining: 14,
    });
    expect(
      getLeadershipEligibility({ partyJoinedTurn: 100, foundedPartyId: null }, 124, "7").eligible
    ).toBe(true);
  });

  it("still grandfathers a missing partyJoinedTurn", () => {
    expect(getLeadershipEligibility({}, 100, "7").eligible).toBe(true);
  });

  it("ignores an empty-string marker rather than exempting every party", () => {
    expect(
      getLeadershipEligibility({ partyJoinedTurn: 100, foundedPartyId: "" }, 100, "").eligible
    ).toBe(false);
  });
});
