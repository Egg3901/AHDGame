import { describe, it, expect } from "vitest";
import {
  INITIAL_POPULAR_LEGITIMACY,
  MAX_POPULAR_LEGITIMACY,
  MIN_POPULAR_LEGITIMACY,
  POPULAR_BANDS,
  POPULAR_RECOVERY_TARGET,
  POPULAR_RECOVERY_RATE,
  classifyPopularBand,
  clampPopular,
  initializePopularLegitimacy,
} from "@/lib/turn/popularLegitimacy";

describe("popular legitimacy formulas", () => {
  describe("constants", () => {
    it("initial = 75", () => {
      expect(INITIAL_POPULAR_LEGITIMACY).toBe(75);
    });
    it("range 0..100", () => {
      expect(MIN_POPULAR_LEGITIMACY).toBe(0);
      expect(MAX_POPULAR_LEGITIMACY).toBe(100);
    });
    it("recovery target = 60, rate = 0.1", () => {
      expect(POPULAR_RECOVERY_TARGET).toBe(60);
      expect(POPULAR_RECOVERY_RATE).toBe(0.1);
    });
  });

  describe("clampPopular", () => {
    it("clamps to MAX", () => {
      expect(clampPopular(150)).toBe(100);
    });
    it("clamps to MIN", () => {
      expect(clampPopular(-5)).toBe(0);
    });
    it("preserves in-range values", () => {
      expect(clampPopular(42)).toBe(42);
    });
    it("clamps NaN to MIN", () => {
      expect(clampPopular(NaN)).toBe(0);
    });
  });

  describe("classifyPopularBand", () => {
    it("returns 'strong' at 75 and above", () => {
      expect(classifyPopularBand(75)).toBe("strong");
      expect(classifyPopularBand(100)).toBe("strong");
    });
    it("returns 'discontent' between 36 and 74", () => {
      expect(classifyPopularBand(74)).toBe("discontent");
      expect(classifyPopularBand(60)).toBe("discontent");
      expect(classifyPopularBand(36)).toBe("discontent");
    });
    it("returns 'crisis' between 16 and 35", () => {
      expect(classifyPopularBand(35)).toBe("crisis");
      expect(classifyPopularBand(16)).toBe("crisis");
    });
    it("returns 'collapsing' below 16", () => {
      expect(classifyPopularBand(15)).toBe("collapsing");
      expect(classifyPopularBand(0)).toBe("collapsing");
    });
    it("handles negatives as collapsing", () => {
      expect(classifyPopularBand(-1)).toBe("collapsing");
    });
  });

  describe("initializePopularLegitimacy", () => {
    it("returns INITIAL_POPULAR_LEGITIMACY", () => {
      expect(initializePopularLegitimacy()).toBe(75);
    });
  });

  describe("POPULAR_BANDS shape", () => {
    it("is sorted by descending min threshold", () => {
      const mins = POPULAR_BANDS.map((b) => b.min);
      const sorted = [...mins].sort((a, b) => b - a);
      expect(mins).toEqual(sorted);
    });
    it("covers the full 0..100 range without gaps", () => {
      // First band must include 100, last band must include 0
      expect(POPULAR_BANDS[0].min).toBeLessThanOrEqual(100);
      expect(POPULAR_BANDS[POPULAR_BANDS.length - 1].min).toBe(0);
    });
  });
});
