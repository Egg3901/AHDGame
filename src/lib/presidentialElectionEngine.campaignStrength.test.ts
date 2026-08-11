import { describe, it, expect } from "vitest";
import {
  CAMPAIGN_STRENGTH_LEADER_PULLBACK_MAX_PER_TURN,
  calculateCampaignStrengthLeaderPullbacks,
  campaignStrengthVoteMultiplier,
} from "@/lib/campaigns/campaignStrength";

/**
 * Unit tests for the campaign strength multiplier formula.
 * The actual integration happens inside accumulatePresidentVoteTurn,
 * but the math is straightforward enough to verify in isolation.
 */

function csMultiplier(campaignStrength: number): number {
  return campaignStrengthVoteMultiplier(campaignStrength);
}

function applyCS(votes: number, campaignStrength: number): number {
  return Math.round(votes * csMultiplier(campaignStrength));
}

describe("campaign strength multiplier", () => {
  it("has no effect at 0 campaign strength", () => {
    expect(applyCS(1000, 0)).toBe(1000);
  });

  it("applies ~2% lift at 1000 campaign strength", () => {
    const result = applyCS(1000, 1000);
    expect(result).toBeGreaterThanOrEqual(1015);
    expect(result).toBeLessThanOrEqual(1025);
  });

  it("applies ~5% lift at 2500 campaign strength", () => {
    const result = applyCS(1000, 2500);
    expect(result).toBeGreaterThanOrEqual(1040);
    expect(result).toBeLessThanOrEqual(1060);
  });

  it("applies diminishing lift at 5000 campaign strength", () => {
    const result = applyCS(1000, 5000);
    expect(result).toBeGreaterThanOrEqual(1085);
    expect(result).toBeLessThanOrEqual(1105);
  });

  it("scales linearly with votes", () => {
    const single = applyCS(1000, 1000);
    const double = applyCS(2000, 1000);
    expect(Math.abs(double - single * 2)).toBeLessThanOrEqual(1);
  });

  it("soft-caps high campaign strength", () => {
    expect(applyCS(1000, 10_000)).toBeGreaterThan(1170);
    expect(applyCS(1000, 10_000)).toBeLessThan(1195);
    expect(applyCS(1000, 60_000)).toBeGreaterThan(1680);
    expect(applyCS(1000, 60_000)).toBeLessThan(1720);
    expect(applyCS(1000, 200_000)).toBeGreaterThan(1970);
    expect(applyCS(1000, 200_000)).toBeLessThan(2000);
  });
});

describe("campaign strength leader pullback", () => {
  it("pulls only the strict leader toward the election average with a per-turn cap", () => {
    const pullbacks = calculateCampaignStrengthLeaderPullbacks([
      { id: "reform", electionId: "pres-1996", campaignStrength: 32_929.43 },
      { id: "dem", electionId: "pres-1996", campaignStrength: 15_189.44 },
      { id: "gop", electionId: "pres-1996", campaignStrength: 2_877.76 },
      { id: "minor", electionId: "pres-1996", campaignStrength: 114.6 },
    ]);

    expect(pullbacks.size).toBe(1);
    expect(pullbacks.get("reform")).toBe(CAMPAIGN_STRENGTH_LEADER_PULLBACK_MAX_PER_TURN);
  });

  it("does not pull the leader below the race average", () => {
    const pullbacks = calculateCampaignStrengthLeaderPullbacks([
      { id: "leader", electionId: "race", campaignStrength: 300 },
      { id: "challenger", electionId: "race", campaignStrength: 200 },
    ]);

    expect(pullbacks.get("leader")).toBe(50);
  });

  it("skips uncontested, archived, and tied leaders", () => {
    const pullbacks = calculateCampaignStrengthLeaderPullbacks([
      { id: "solo", electionId: "solo-race", campaignStrength: 1000 },
      { id: "archived-leader", electionId: "race", campaignStrength: 1000, status: "archived" },
      { id: "tie-a", electionId: "race", campaignStrength: 100 },
      { id: "tie-b", electionId: "race", campaignStrength: 100 },
    ]);

    expect(pullbacks.size).toBe(0);
  });
});
