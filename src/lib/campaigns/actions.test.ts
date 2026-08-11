import { describe, it, expect } from "vitest";
import { calculateCampaignActions } from "./actions";

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
