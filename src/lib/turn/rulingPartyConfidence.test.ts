import { describe, it, expect } from "vitest";
import {
  INITIAL_CONFIDENCE,
  MAX_CONFIDENCE,
  MIN_CONFIDENCE,
  classifyConfidenceBand,
  clampConfidence,
  initializeLeaderConfidence,
  applyLeadershipRenewalBump,
} from "@/lib/turn/rulingPartyConfidence";

describe("Ruling-party confidence formulas", () => {
  describe("classifyConfidenceBand", () => {
    it("returns 'secure' for 80–100", () => {
      expect(classifyConfidenceBand(80)).toBe("secure");
      expect(classifyConfidenceBand(95)).toBe("secure");
      expect(classifyConfidenceBand(100)).toBe("secure");
    });

    it("returns 'stable' for 65–79", () => {
      expect(classifyConfidenceBand(65)).toBe("stable");
      expect(classifyConfidenceBand(79)).toBe("stable");
    });

    it("returns 'watchful' for 50–64", () => {
      expect(classifyConfidenceBand(50)).toBe("watchful");
      expect(classifyConfidenceBand(64)).toBe("watchful");
    });

    it("returns 'strained' for 35–49", () => {
      expect(classifyConfidenceBand(35)).toBe("strained");
      expect(classifyConfidenceBand(49)).toBe("strained");
    });

    it("returns 'crisis' for 20–34", () => {
      expect(classifyConfidenceBand(20)).toBe("crisis");
      expect(classifyConfidenceBand(34)).toBe("crisis");
    });

    it("returns 'critical' for 0–19", () => {
      expect(classifyConfidenceBand(0)).toBe("critical");
      expect(classifyConfidenceBand(19)).toBe("critical");
    });

    it("handles negative values as critical", () => {
      expect(classifyConfidenceBand(-5)).toBe("critical");
    });
  });

  describe("clampConfidence", () => {
    it("clamps to MAX_CONFIDENCE", () => {
      expect(clampConfidence(100)).toBe(MAX_CONFIDENCE);
      expect(clampConfidence(200)).toBe(MAX_CONFIDENCE);
    });

    it("clamps to MIN_CONFIDENCE", () => {
      expect(clampConfidence(-10)).toBe(MIN_CONFIDENCE);
      expect(clampConfidence(-1)).toBe(MIN_CONFIDENCE);
    });

    it("preserves values in range", () => {
      expect(clampConfidence(0)).toBe(0);
      expect(clampConfidence(50)).toBe(50);
      expect(clampConfidence(95)).toBe(95);
    });
  });

  describe("initializeLeaderConfidence", () => {
    it("returns INITIAL_CONFIDENCE (75)", () => {
      expect(initializeLeaderConfidence()).toBe(INITIAL_CONFIDENCE);
    });
  });

  describe("applyLeadershipRenewalBump", () => {
    it("adds RENEWAL_BUMP (+5) normally", () => {
      expect(applyLeadershipRenewalBump(70)).toBe(75);
      expect(applyLeadershipRenewalBump(50)).toBe(55);
    });

    it("caps at MAX_CONFIDENCE (95)", () => {
      expect(applyLeadershipRenewalBump(92)).toBe(MAX_CONFIDENCE);
      expect(applyLeadershipRenewalBump(95)).toBe(MAX_CONFIDENCE);
    });
  });
});
