import { describe, it, expect } from "vitest";
import {
  CAMPAIGN_ACTION_BANK_TURNS,
  campaignActionBankCap,
  cappedCampaignActionGrant,
} from "./actions";

describe("campaign action bank cap", () => {
  it("caps the bank at CAMPAIGN_ACTION_BANK_TURNS of the campaign's own income", () => {
    expect(CAMPAIGN_ACTION_BANK_TURNS).toBe(48);
    expect(campaignActionBankCap(5)).toBe(240);
    expect(campaignActionBankCap(0)).toBe(0);
    expect(campaignActionBankCap(Number.NaN)).toBe(0);
  });

  it("pays full income while below the cap", () => {
    expect(cappedCampaignActionGrant(0, 5)).toBe(5);
    expect(cappedCampaignActionGrant(235, 5)).toBe(5);
  });

  it("clamps income so it never pushes the bank past the cap", () => {
    expect(cappedCampaignActionGrant(238, 5)).toBe(2);
    expect(cappedCampaignActionGrant(240, 5)).toBe(0);
  });

  it("never claws back a balance already over the cap", () => {
    expect(cappedCampaignActionGrant(500, 5)).toBe(0);
  });

  it("resumes income once the campaign spends below the cap", () => {
    expect(cappedCampaignActionGrant(239, 5)).toBe(1);
    expect(cappedCampaignActionGrant(100, 5)).toBe(5);
  });

  it("treats a missing balance as zero and a zero income as nothing", () => {
    expect(cappedCampaignActionGrant(Number.NaN, 4)).toBe(4);
    expect(cappedCampaignActionGrant(10, 0)).toBe(0);
  });
});
