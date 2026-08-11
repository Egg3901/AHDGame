import { describe, it, expect } from "vitest";
import type { Election } from "@/lib/db/types";
import { isCampaignEligibleElection } from "./isCampaignEligible";

describe("isCampaignEligibleElection — Phase 5.5 eligibility matrix", () => {
  describe("Presidential path (unchanged from pre-Phase-5.5)", () => {
    it("returns true for US presidential elections", () => {
      expect(isCampaignEligibleElection({ countryId: "US", electionType: "president" })).toBe(true);
    });
  });

  describe("US non-presidential races (Phase 5.5 newly eligible)", () => {
    it("returns true for US senate", () => {
      expect(isCampaignEligibleElection({ countryId: "US", electionType: "senate" })).toBe(true);
    });
    it("returns true for US governor", () => {
      expect(isCampaignEligibleElection({ countryId: "US", electionType: "governor" })).toBe(true);
    });
    it("returns true for US house", () => {
      expect(isCampaignEligibleElection({ countryId: "US", electionType: "house" })).toBe(true);
    });
    it("returns true for US state senate", () => {
      expect(isCampaignEligibleElection({ countryId: "US", electionType: "stateSenate" })).toBe(
        true
      );
    });
  });

  describe("Non-US races (deferred per Phase 5.5 D4)", () => {
    it("returns false for JP shugiin / sangiin / governor", () => {
      expect(isCampaignEligibleElection({ countryId: "JP", electionType: "shugiin" })).toBe(false);
      expect(isCampaignEligibleElection({ countryId: "JP", electionType: "sangiin" })).toBe(false);
      expect(isCampaignEligibleElection({ countryId: "JP", electionType: "governor" })).toBe(false);
    });
    it("returns false for UK commons / regionalCouncil", () => {
      expect(isCampaignEligibleElection({ countryId: "UK", electionType: "commons" })).toBe(false);
      expect(isCampaignEligibleElection({ countryId: "UK", electionType: "regionalCouncil" })).toBe(
        false
      );
    });
    it("returns false for DE bundestag", () => {
      expect(isCampaignEligibleElection({ countryId: "DE", electionType: "bundestag" })).toBe(
        false
      );
    });
    it("returns false even for race types that ARE eligible in US (no cross-country leak)", () => {
      // 'senate' is US-eligible, but a hypothetical UK senate race must NOT inherit eligibility.
      expect(isCampaignEligibleElection({ countryId: "UK", electionType: "senate" })).toBe(false);
      expect(isCampaignEligibleElection({ countryId: "JP", electionType: "house" })).toBe(false);
    });
  });

  describe("Defensive guards", () => {
    it("returns false when countryId is missing", () => {
      expect(isCampaignEligibleElection({ electionType: "president" })).toBe(false);
      expect(isCampaignEligibleElection({ electionType: "senate" })).toBe(false);
    });
    it("returns false when electionType is missing", () => {
      expect(isCampaignEligibleElection({ countryId: "US" })).toBe(false);
    });
    it("returns false for unknown electionType strings", () => {
      expect(
        isCampaignEligibleElection({
          countryId: "US",
          electionType: "fictional-race-type" as unknown as Election["electionType"],
        })
      ).toBe(false);
    });
  });
});
