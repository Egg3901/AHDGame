import { describe, expect, it } from "vitest";
import { POLITICAL_METRIC_FAMILIES } from "@/lib/politicalMetrics/families";
import type { PoliticalMetricId } from "@/lib/politicalMetrics/types";
import { legacyPoliticalHalfFromBoard } from "./legacyProjection";

const uniform = (v: number) => {
  const out = {} as Record<PoliticalMetricId, number>;
  for (const f of POLITICAL_METRIC_FAMILIES) out[f.id] = v;
  return out;
};

describe("legacyPoliticalHalfFromBoard", () => {
  it("returns null for an absent or empty board", () => {
    expect(legacyPoliticalHalfFromBoard(null)).toBeNull();
    expect(legacyPoliticalHalfFromBoard(undefined)).toBeNull();
    expect(legacyPoliticalHalfFromBoard({} as Record<PoliticalMetricId, number>)).toBeNull();
  });

  it("projects into legacy categories with real units, not 0-100 scores", () => {
    const out = legacyPoliticalHalfFromBoard(uniform(100))!;
    // Best-possible board → best end of each metric's realistic range.
    expect(out.healthcare?.lifeExpectancy?.value).toBeGreaterThan(80);
    expect(out.education?.literacyRate?.value).toBeGreaterThan(90);
    // A 0-100 score wearing a legacy name would have been 100 here.
    expect(out.healthcare.lifeExpectancy.value).toBeLessThan(100);
  });

  it("honours polarity — a great board means LOW crime and LOW corruption", () => {
    const great = legacyPoliticalHalfFromBoard(uniform(100))!;
    const awful = legacyPoliticalHalfFromBoard(uniform(0))!;
    expect(great.publicSafety.crimeRate.value).toBeLessThan(awful.publicSafety.crimeRate.value);
    expect(great.governance.corruptionIndex.value).toBeLessThan(
      awful.governance.corruptionIndex.value
    );
    expect(great.education.literacyRate.value).toBeGreaterThan(awful.education.literacyRate.value);
  });

  it("never projects the macro categories", () => {
    // economic/population belong to macroMetrics; overwriting them with a
    // board-derived approximation would clobber live economic state.
    const out = legacyPoliticalHalfFromBoard(uniform(60))!;
    expect(out.economic).toBeUndefined();
    expect(out.population).toBeUndefined();
  });

  it("never projects governance.independenceDesire", () => {
    // Feature state owned by its drift phase, and it has no adapter row.
    const out = legacyPoliticalHalfFromBoard(uniform(60))!;
    expect(out.governance?.independenceDesire).toBeUndefined();
  });

  it("emits finite values for every projected metric", () => {
    for (const score of [0, 25, 50, 75, 100]) {
      const out = legacyPoliticalHalfFromBoard(uniform(score))!;
      for (const [category, metrics] of Object.entries(out)) {
        for (const [metricId, mv] of Object.entries(metrics)) {
          expect(Number.isFinite(mv.value), `${category}.${metricId} @${score}`).toBe(true);
        }
      }
    }
  });
});
