import { describe, expect, it } from "vitest";
import { primaryMetricById } from "@/lib/resetMetrics/catalog";
import { leaveToStatesOption, resetLawFamilies, resetLawFamilyById } from "./catalog";

describe("reset legislative catalog", () => {
  it("contains 51 distinct law families with five authored policy levels", () => {
    expect(resetLawFamilies).toHaveLength(51);
    expect(new Set(resetLawFamilies.map((family) => family.id)).size).toBe(51);
    for (const family of resetLawFamilies) {
      expect(family.levels.map((level) => level.position)).toEqual([
        "far_left",
        "center_left",
        "center",
        "center_right",
        "far_right",
      ]);
      for (const level of family.levels) {
        expect(level.title.trim()).not.toBe("");
        expect(level.description.trim()).not.toBe("");
        expect(level.description).not.toMatch(/[\u2013\u2014]/);
      }
    }
  });

  it("connects every law to a defined primary metric and country scope", () => {
    for (const family of resetLawFamilies) {
      expect(family.primaryMetricIds.length).toBeGreaterThan(0);
      for (const id of family.primaryMetricIds) expect(primaryMetricById(id)).toBeDefined();
      expect(family.availability.national).toContain("US");
      expect(family.availability.national).toContain("UK");
      expect(family.availability.national).toContain("JP");
    }
    expect(resetLawFamilyById("L18")?.title).toBeTruthy();
  });

  it("keeps unreviewed legal components and prices out of runtime eligibility", () => {
    for (const family of resetLawFamilies) {
      expect(family.review.legalComponents).toBe("required");
      expect(family.review.allocation).toBe("required");
      expect(family.review.outcomeCalibration).toBe("required");
    }
  });

  it("models state discretion separately from the five policy levels", () => {
    expect(leaveToStatesOption(resetLawFamilyById("L18")!)?.title).toBe("Leave it to the States");
    expect(leaveToStatesOption(resetLawFamilyById("L01")!)).toBeNull();
    expect(resetLawFamilyById("L18")?.levels).toHaveLength(5);
  });
});
