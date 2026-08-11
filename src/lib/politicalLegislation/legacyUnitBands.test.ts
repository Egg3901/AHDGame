import { describe, expect, it } from "vitest";
import {
  LEGACY_UNIT_BANDS,
  legacyUnitFromPoliticalScore,
  modulateByPoliticalScore,
} from "./legacyUnitBands";
import { LIFE_EXPECTANCY_MID, PREVENTABLE_MORTALITY_MID } from "@/lib/demographics/flows/mortality";

describe("legacyUnitFromPoliticalScore", () => {
  it("returns the metric's neutral value at score 50 — the parity property", () => {
    // 50 is the political-scale neutral. Every consumer already uses these mids
    // when the metric is absent, so a playable region at 50 behaves EXACTLY as
    // it does today. Any deviation here is a silent balance change.
    expect(legacyUnitFromPoliticalScore("healthcare.lifeExpectancy", 50)).toBe(LIFE_EXPECTANCY_MID);
    expect(legacyUnitFromPoliticalScore("healthcare.preventableMortality", 50)).toBe(
      PREVENTABLE_MORTALITY_MID
    );
  });

  it("maps score 100/0 to the band edges", () => {
    expect(legacyUnitFromPoliticalScore("healthcare.lifeExpectancy", 100)).toBe(85);
    expect(legacyUnitFromPoliticalScore("healthcare.lifeExpectancy", 0)).toBe(70);
  });

  it("inverts lower-is-better metrics", () => {
    // A HIGH health.prevention score means FEWER preventable deaths.
    expect(legacyUnitFromPoliticalScore("healthcare.preventableMortality", 100)).toBe(120);
    expect(legacyUnitFromPoliticalScore("healthcare.preventableMortality", 0)).toBe(500);
  });

  it("clamps scores outside 0-100", () => {
    expect(legacyUnitFromPoliticalScore("healthcare.lifeExpectancy", 140)).toBe(85);
    expect(legacyUnitFromPoliticalScore("healthcare.lifeExpectancy", -20)).toBe(70);
  });

  it("returns null for a path with no band", () => {
    expect(legacyUnitFromPoliticalScore("economic.gdpGrowth", 70)).toBeNull();
  });

  it("covers every TFP basket input and both mortality inputs", () => {
    for (const path of [
      "healthcare.lifeExpectancy",
      "healthcare.preventableMortality",
      "education.workforceSkill",
      "infrastructure.transportEfficiency",
      "infrastructure.broadbandAccess",
      "infrastructure.powerGridReliability",
    ]) {
      expect(LEGACY_UNIT_BANDS[path], path).toBeDefined();
    }
  });
});

describe("modulateByPoliticalScore", () => {
  it("leaves the base untouched at score 50", () => {
    expect(modulateByPoliticalScore(37, 50, 20)).toBe(37);
  });

  it("shifts the base by up to ±halfSpan at the score extremes", () => {
    expect(modulateByPoliticalScore(37, 100, 20)).toBe(57);
    expect(modulateByPoliticalScore(37, 0, 20)).toBe(17);
  });

  it("clamps the score before applying", () => {
    expect(modulateByPoliticalScore(37, 999, 20)).toBe(57);
  });
});
