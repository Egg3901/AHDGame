import { describe, expect, it } from "vitest";
import {
  ASSESS_ESTIMATE_COVERAGE,
  ASSESS_EXACT_COVERAGE,
  ASSESS_EXISTENCE_COVERAGE,
  INTEL_FOG_MAX_DEVIATION,
} from "./config";
import { assessNuclear, assessmentTier, type NuclearFacts } from "./strategicAssessment";

const FACTS: NuclearFacts = {
  hasProgramme: true,
  warheads: 200,
  adoptedNodeCount: 4,
  covert: { active: true, stage: 3, stageCount: 5 },
};

const at = (coverage: number, facts: NuclearFacts = FACTS) =>
  assessNuclear(facts, coverage, "DD", 10);

describe("assessmentTier", () => {
  it("climbs with coverage", () => {
    expect(assessmentTier(0)).toBe("none");
    expect(assessmentTier(ASSESS_EXISTENCE_COVERAGE)).toBe("existence");
    expect(assessmentTier(ASSESS_ESTIMATE_COVERAGE)).toBe("estimate");
    expect(assessmentTier(ASSESS_EXACT_COVERAGE)).toBe("exact");
  });

  it("treats a non-finite reading as knowing nothing", () => {
    expect(assessmentTier(Number.NaN)).toBe("none");
  });
});

describe("assessNuclear", () => {
  it("reveals nothing at all below the existence tier", () => {
    const a = at(ASSESS_EXISTENCE_COVERAGE - 1);
    expect(a.hasProgramme).toBeNull();
    expect(a.warheads).toBeNull();
    expect(a.adoptedNodeCount).toBeNull();
    expect(a.covertSuspected).toBe(false);
    expect(a.covertStage).toBeNull();
  });

  it("answers only the existence question at the existence tier", () => {
    const a = at(ASSESS_EXISTENCE_COVERAGE);
    expect(a.hasProgramme).toBe(true);
    expect(a.warheads).toBeNull();
    expect(a.adoptedNodeCount).toBeNull();
  });

  it("reports an ABSENT programme as absent, which is intelligence too", () => {
    const a = at(ASSESS_EXISTENCE_COVERAGE, { ...FACTS, hasProgramme: false });
    expect(a.hasProgramme).toBe(false);
  });

  it("does not hint at a covert programme at the existence tier", () => {
    expect(at(ASSESS_EXISTENCE_COVERAGE).covertSuspected).toBe(false);
  });

  it("gives a FOGGED warhead estimate at the estimate tier", () => {
    const a = at(ASSESS_ESTIMATE_COVERAGE);
    expect(a.warheadsAreEstimate).toBe(true);
    expect(a.warheads).not.toBeNull();
    expect(a.warheads).toBeGreaterThanOrEqual(200 * (1 - INTEL_FOG_MAX_DEVIATION) - 1);
    expect(a.warheads).toBeLessThanOrEqual(200 * (1 + INTEL_FOG_MAX_DEVIATION) + 1);
  });

  it("suspects but does not size a covert programme at the estimate tier", () => {
    const a = at(ASSESS_ESTIMATE_COVERAGE);
    expect(a.covertSuspected).toBe(true);
    expect(a.covertStage).toBeNull();
    expect(a.covertStageCount).toBeNull();
  });

  it("gives the exact count and the covert stage at the exact tier", () => {
    const a = at(ASSESS_EXACT_COVERAGE);
    expect(a.warheadsAreEstimate).toBe(false);
    expect(a.warheads).toBe(200);
    expect(a.adoptedNodeCount).toBe(4);
    expect(a.covertStage).toBe(3);
    expect(a.covertStageCount).toBe(5);
  });

  it("never invents a covert programme for a country that cannot run one", () => {
    const a = assessNuclear({ ...FACTS, covert: null }, 100, "US", 10);
    expect(a.covertSuspected).toBe(false);
    expect(a.covertStage).toBeNull();
  });

  it("never reports a dormant covert programme as suspected", () => {
    const a = assessNuclear(
      { ...FACTS, covert: { active: false, stage: 0, stageCount: 5 } },
      100,
      "DD",
      10
    );
    expect(a.covertSuspected).toBe(false);
    expect(a.covertStage).toBeNull();
  });

  it("is deterministic, so refreshing a read cannot average the fog away", () => {
    expect(at(ASSESS_ESTIMATE_COVERAGE)).toEqual(at(ASSESS_ESTIMATE_COVERAGE));
  });

  it("fogs warheads and nodes independently", () => {
    // Sharing a factor would publish the exact ratio of the two figures.
    const a = assessNuclear(
      { hasProgramme: true, warheads: 1000, adoptedNodeCount: 1000, covert: null },
      ASSESS_ESTIMATE_COVERAGE,
      "RU",
      10
    );
    expect(a.warheads).not.toBe(a.adoptedNodeCount);
  });
});
