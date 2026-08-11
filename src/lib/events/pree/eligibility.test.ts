import { describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import { matchesEligibility, type CharacterEventContext } from "./eligibility";

function ctx(overrides: Partial<CharacterEventContext> = {}): CharacterEventContext {
  return {
    characterId: new ObjectId(),
    countryId: "US",
    isPolitician: false,
    isCeo: false,
    isInElection: false,
    ...overrides,
  };
}

describe("PREE eligibility", () => {
  it("matches all-tagged templates for any character", () => {
    expect(matchesEligibility(ctx(), ["all"])).toBe(true);
  });

  it("matches politician when holding office or in election", () => {
    expect(matchesEligibility(ctx({ isPolitician: true }), ["politician"])).toBe(true);
    expect(matchesEligibility(ctx(), ["politician"])).toBe(false);
  });

  it("matches ceo and inElection tags independently", () => {
    expect(matchesEligibility(ctx({ isCeo: true }), ["ceo"])).toBe(true);
    expect(matchesEligibility(ctx({ isInElection: true }), ["inElection"])).toBe(true);
  });

  describe("ceoConcentrated", () => {
    it("returns true when fraction > 0.65", () => {
      expect(matchesEligibility(ctx({ ceoOwnershipFraction: 0.7 }), ["ceoConcentrated"])).toBe(
        true
      );
    });
    it("returns false when fraction === 0.65", () => {
      expect(matchesEligibility(ctx({ ceoOwnershipFraction: 0.65 }), ["ceoConcentrated"])).toBe(
        false
      );
    });
    it("returns false when fraction undefined", () => {
      expect(matchesEligibility(ctx(), ["ceoConcentrated"])).toBe(false);
    });
  });

  describe("ceoVeryConcentrated", () => {
    it("returns true when fraction > 0.80", () => {
      expect(matchesEligibility(ctx({ ceoOwnershipFraction: 0.85 }), ["ceoVeryConcentrated"])).toBe(
        true
      );
    });
    it("returns false when fraction === 0.80", () => {
      expect(matchesEligibility(ctx({ ceoOwnershipFraction: 0.8 }), ["ceoVeryConcentrated"])).toBe(
        false
      );
    });
    it("returns false when fraction < 0.65", () => {
      expect(matchesEligibility(ctx({ ceoOwnershipFraction: 0.5 }), ["ceoVeryConcentrated"])).toBe(
        false
      );
    });
  });
});
