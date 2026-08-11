import { describe, it, expect } from "vitest";
import {
  isWithinTwoPoints,
  getEligibleDemographics,
  calculateAlignmentMultiplier,
} from "./demographicAlignment";

describe("demographicAlignment", () => {
  describe("isWithinTwoPoints", () => {
    it("returns true when within 2 points on both axes", () => {
      expect(isWithinTwoPoints(4, 4, 5, 5)).toBe(true);
      expect(isWithinTwoPoints(4, 4, 3, 3)).toBe(true);
      expect(isWithinTwoPoints(4, 4, 2, 2)).toBe(true);
    });

    it("returns false when more than 2 points away on either axis", () => {
      expect(isWithinTwoPoints(4, 4, 1, 4)).toBe(false);
      expect(isWithinTwoPoints(4, 4, 4, 1)).toBe(false);
      expect(isWithinTwoPoints(4, 4, -1, -1)).toBe(false);
    });
  });

  describe("calculateAlignmentMultiplier", () => {
    it("returns 1.0 for perfect alignment", () => {
      expect(calculateAlignmentMultiplier(4, 4, 4, 4)).toBe(1.0);
    });

    it("returns scaled multiplier for partial alignment", () => {
      // Distance = 3 → multiplier = 1.0 - (3 * 0.15) = 0.55
      expect(calculateAlignmentMultiplier(4, 4, 5, 6)).toBeCloseTo(0.55);
    });

    it("returns minimum 0.1 for misaligned", () => {
      expect(calculateAlignmentMultiplier(5, 5, -5, -5)).toBe(0.1);
    });
  });

  describe("getEligibleDemographics", () => {
    const mockDemographics = [
      { category: "race" as const, group: "white", economicLean: 4, socialLean: 4 },
      { category: "ideology" as const, group: "evangelicals", economicLean: 4, socialLean: 5 },
      { category: "ideology" as const, group: "progressives", economicLean: -5, socialLean: -5 },
    ];

    it("returns demographics within 2 points", () => {
      const eligible = getEligibleDemographics(4, 4, mockDemographics);
      expect(eligible).toHaveLength(2);
      expect(eligible[0].group).toBe("white");
      expect(eligible[1].group).toBe("evangelicals");
    });

    it("returns empty array when no eligible demographics", () => {
      const eligible = getEligibleDemographics(-5, -5, mockDemographics);
      expect(eligible).toHaveLength(1); // only progressives
    });

    it("handles empty input array", () => {
      const eligible = getEligibleDemographics(0, 0, []);
      expect(eligible).toHaveLength(0);
    });
  });
});
