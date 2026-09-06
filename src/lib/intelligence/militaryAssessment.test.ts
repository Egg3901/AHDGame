import { describe, expect, it } from "vitest";
import {
  ASSESS_ESTIMATE_COVERAGE,
  ASSESS_EXACT_COVERAGE,
  ASSESS_EXISTENCE_COVERAGE,
  INTEL_FOG_MAX_DEVIATION,
} from "./config";
import { assessMilitary, type MilitaryFacts } from "./militaryAssessment";

const FACTS: MilitaryFacts = {
  formationCount: 120,
  meanReadiness: 70,
  fronts: [
    { conflictId: "war_us_dd", supply: 62 },
    { conflictId: "war_dd_pl", supply: 48 },
  ],
};

const at = (coverage: number, facts: MilitaryFacts = FACTS) =>
  assessMilitary(facts, coverage, "DD", 10);

describe("assessMilitary", () => {
  it("reveals nothing below the existence tier", () => {
    const a = at(ASSESS_EXISTENCE_COVERAGE - 1);
    expect(a.atWar).toBeNull();
    expect(a.frontCount).toBeNull();
    expect(a.formationCount).toBeNull();
    expect(a.fronts).toBeNull();
  });

  it("answers whether they are fighting, and where, at the existence tier", () => {
    const a = at(ASSESS_EXISTENCE_COVERAGE);
    expect(a.atWar).toBe(true);
    expect(a.frontCount).toBe(2);
    expect(a.formationCount).toBeNull();
    expect(a.meanReadiness).toBeNull();
  });

  it("reports a country at peace as at peace", () => {
    const a = at(ASSESS_EXISTENCE_COVERAGE, { ...FACTS, fronts: [] });
    expect(a.atWar).toBe(false);
    expect(a.frontCount).toBe(0);
  });

  it("gives fogged strength and readiness at the estimate tier", () => {
    const a = at(ASSESS_ESTIMATE_COVERAGE);
    expect(a.figuresAreEstimate).toBe(true);
    expect(a.formationCount).toBeGreaterThanOrEqual(120 * (1 - INTEL_FOG_MAX_DEVIATION) - 1);
    expect(a.formationCount).toBeLessThanOrEqual(120 * (1 + INTEL_FOG_MAX_DEVIATION) + 1);
    expect(a.meanReadiness).not.toBeNull();
  });

  it("withholds per-front supply until the exact tier: that is targeting data", () => {
    expect(at(ASSESS_ESTIMATE_COVERAGE).fronts).toBeNull();
    expect(at(ASSESS_EXACT_COVERAGE).fronts).toEqual(FACTS.fronts);
  });

  it("gives exact figures at the exact tier", () => {
    const a = at(ASSESS_EXACT_COVERAGE);
    expect(a.figuresAreEstimate).toBe(false);
    expect(a.formationCount).toBe(120);
    expect(a.meanReadiness).toBe(70);
  });

  it("fogs strength and readiness independently", () => {
    // A shared factor would publish the exact ratio of strength to readiness,
    // which is most of what the estimate is hiding.
    const a = assessMilitary(
      { formationCount: 1000, meanReadiness: 1000, fronts: [] },
      ASSESS_ESTIMATE_COVERAGE,
      "RU",
      10
    );
    expect(a.formationCount).not.toBe(a.meanReadiness);
  });

  it("is deterministic, so refreshing cannot average the fog away", () => {
    expect(at(ASSESS_ESTIMATE_COVERAGE)).toEqual(at(ASSESS_ESTIMATE_COVERAGE));
  });

  it("rounds an exact readiness rather than serving a fraction", () => {
    const a = assessMilitary({ ...FACTS, meanReadiness: 70.4 }, ASSESS_EXACT_COVERAGE, "DD", 10);
    expect(a.meanReadiness).toBe(70);
  });
});
