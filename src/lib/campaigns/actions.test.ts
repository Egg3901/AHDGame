import { describe, it, expect } from "vitest";
import { calculateCampaignActions, campaignActionsPerTurn } from "./actions";

describe("calculateCampaignActions", () => {
  it("returns 1 with zero endorsements (floor)", () => {
    expect(calculateCampaignActions(0)).toBe(1);
  });

  it("calculates actions with square root scaling plus floor", () => {
    expect(calculateCampaignActions(1)).toBe(4); // 1 + floor(sqrt(1)*3) = 1+3
    expect(calculateCampaignActions(4)).toBe(7); // 1 + floor(sqrt(4)*3) = 1+6
    expect(calculateCampaignActions(9)).toBe(10); // 1 + floor(sqrt(9)*3) = 1+9
    expect(calculateCampaignActions(16)).toBe(13); // 1 + floor(sqrt(16)*3) = 1+12
    expect(calculateCampaignActions(25)).toBe(16); // 1 + floor(sqrt(25)*3) = 1+15
  });

  it("floors decimal results", () => {
    expect(calculateCampaignActions(2)).toBe(5); // 1 + floor(sqrt(2)*3) = 1+4
    expect(calculateCampaignActions(10)).toBe(10); // 1 + floor(sqrt(10)*3) = 1+9
  });

  it("handles invalid inputs safely — returns floor of 1", () => {
    expect(calculateCampaignActions(-1)).toBe(1);
    expect(calculateCampaignActions(-10)).toBe(1);
    expect(calculateCampaignActions(NaN)).toBe(1);
    expect(calculateCampaignActions(Infinity)).toBe(1);
  });
});

/**
 * One accrual for both callers. The turn engine pays what this returns and the
 * campaign desk promises what this returns, so a campaign cannot be shown a
 * figure it will not earn. Every rule the engine applied privately lives here
 * now, which is what these cases pin down.
 */
describe("campaignActionsPerTurn", () => {
  const base = {
    nppEndorsements: 0,
    playerEndorsements: 0,
    governorEndorsements: 0,
    executiveEndorsements: 0,
    isPresidential: false,
    candidateIsNPP: false,
    baseActionsPerTurn: 4,
  };

  it("floors the baseline at four however low the game config sets it", () => {
    expect(campaignActionsPerTurn({ ...base, baseActionsPerTurn: 1 })).toBe(4);
    expect(campaignActionsPerTurn({ ...base, baseActionsPerTurn: 6 })).toBe(6);
  });

  it("halves the baseline for a campaign an NPP is running", () => {
    expect(campaignActionsPerTurn({ ...base, candidateIsNPP: true })).toBe(2);
  });

  it("counts politician endorsements in every race type", () => {
    expect(campaignActionsPerTurn({ ...base, nppEndorsements: 4 })).toBe(10);
    expect(campaignActionsPerTurn({ ...base, nppEndorsements: 4, isPresidential: true })).toBe(10);
  });

  it("counts player endorsements only in a presidential race", () => {
    expect(campaignActionsPerTurn({ ...base, playerEndorsements: 9 })).toBe(4);
    expect(campaignActionsPerTurn({ ...base, playerEndorsements: 9, isPresidential: true })).toBe(
      13
    );
  });

  it("weights a governor endorsement above a single politician, below a race it cannot reach", () => {
    // 2 governors weigh 3.0, so floor(sqrt(3) * 3) = 5 over the baseline.
    expect(campaignActionsPerTurn({ ...base, governorEndorsements: 2 })).toBe(9);
    // A governor's presidential endorsement is state-scoped and lands as an
    // in-state vote multiplier instead, so it grants no national actions.
    expect(campaignActionsPerTurn({ ...base, governorEndorsements: 2, isPresidential: true })).toBe(
      4
    );
  });

  it("weights an executive endorsement the same in every race", () => {
    expect(campaignActionsPerTurn({ ...base, executiveEndorsements: 2 })).toBe(9);
    expect(
      campaignActionsPerTurn({ ...base, executiveEndorsements: 2, isPresidential: true })
    ).toBe(9);
  });

  it("adds the sources together before the curve, not after", () => {
    // 13 + 2 = 15 under one sqrt is 15 actions; curved separately it would be 18.
    expect(
      campaignActionsPerTurn({
        ...base,
        nppEndorsements: 13,
        playerEndorsements: 2,
        isPresidential: true,
      })
    ).toBe(15);
  });

  it("survives a missing game config without paying nothing", () => {
    expect(campaignActionsPerTurn({ ...base, baseActionsPerTurn: NaN })).toBe(4);
  });
});
