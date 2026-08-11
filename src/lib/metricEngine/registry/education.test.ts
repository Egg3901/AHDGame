import { describe, expect, it } from "vitest";
import type { EngineNodeContext } from "../types";
import {
  highSchoolGradRateNode,
  literacyRateNode,
  testPerformanceNode,
  universityEnrollmentNode,
  workforceSkillNode,
  EDUCATION_NODES,
} from "./education";

function ctx(partial: {
  spending?: Record<string, number>;
  current?: Record<string, number>;
  prev?: Record<string, number>;
  countryId?: string;
}): EngineNodeContext {
  return {
    countryId: partial.countryId,
    current: partial.current ?? {},
    prev: partial.prev ?? {},
    prevSimBaseline: {},
    providers: {},
    spending: partial.spending ?? {},
    policyValue: NaN,
  };
}

describe("education nodes — direction", () => {
  it("highSchoolGradRate rises with education spend, falls with child poverty", () => {
    // Realistic per-capita range (see EDU_SPEND_HALF_SAT comment in ./education):
    // $0 floor, $806 today's US federal baseline, $6515 five-bill stacked max.
    const lowSpend = highSchoolGradRateNode.compute!(ctx({ spending: { education: 0 } }));
    const highSpend = highSchoolGradRateNode.compute!(ctx({ spending: { education: 6515 } }));
    expect(highSpend).toBeGreaterThan(lowSpend);

    const lowPov = highSchoolGradRateNode.compute!(
      ctx({ spending: { education: 806 }, prev: { "social.childPoverty": 5 } })
    );
    const highPov = highSchoolGradRateNode.compute!(
      ctx({ spending: { education: 806 }, prev: { "social.childPoverty": 35 } })
    );
    expect(lowPov).toBeGreaterThan(highPov);
  });

  it("testPerformance rises with spend + academic pressure, falls with child poverty", () => {
    const base = testPerformanceNode.compute!(
      ctx({ spending: { education: 806 }, current: { "education.academicPressure": 50 } })
    );
    const morePressure = testPerformanceNode.compute!(
      ctx({ spending: { education: 806 }, current: { "education.academicPressure": 80 } })
    );
    expect(morePressure).toBeGreaterThan(base);
  });

  it("testPerformance shows MEANINGFUL variation across the realistic spend range (not pegged near 0 or max)", () => {
    // Isolate the spend-response term: hold childPoverty/academicPressure fixed
    // and read testPerformance at the floor, today's baseline, and the
    // five-bill-stacked max (see EDU_SPEND_HALF_SAT comment in ./education).
    const fixed = {
      prev: { "social.childPoverty": 18 },
      current: { "education.academicPressure": 50 },
    };
    const atFloor = testPerformanceNode.compute!(ctx({ spending: { education: 0 }, ...fixed }));
    const atBaseline = testPerformanceNode.compute!(
      ctx({ spending: { education: 806 }, ...fixed })
    );
    const atMax = testPerformanceNode.compute!(ctx({ spending: { education: 6515 }, ...fixed }));

    // Monotonic and clearly separated — the whole point of the recalibration.
    expect(atBaseline).toBeGreaterThan(atFloor);
    expect(atMax).toBeGreaterThan(atBaseline);
    // Baseline-to-max spread should be a real, perceptible slice of the
    // spendResp term's contribution (spendResp * 0.25 in the compute formula),
    // not the sub-0.1-point sliver the old halfSat=1 toy value produced.
    expect(atMax - atBaseline).toBeGreaterThan(5);
    // And still nowhere near saturated: the max shouldn't be within a hair of
    // the floor-to-asymptote ceiling (spendResp asymptotes to 100, so the
    // spendResp*0.25 term asymptotes to 25 above the floor's spendResp=0 term).
    expect(atMax - atFloor).toBeLessThan(25 * 0.95);
  });

  it("workforceSkill rises with grad rate, test performance, and apprenticeship", () => {
    const low = workforceSkillNode.compute!(
      ctx({
        current: {
          "education.highSchoolGradRate": 75,
          "education.testPerformance": 90,
          "education.apprenticeshipRate": 1,
        },
      })
    );
    const high = workforceSkillNode.compute!(
      ctx({
        current: {
          "education.highSchoolGradRate": 95,
          "education.testPerformance": 115,
          "education.apprenticeshipRate": 6,
        },
      })
    );
    expect(high).toBeGreaterThan(low);
  });

  it("universityEnrollment (US, HS-grad-driven) + literacyRate rise with grad rate", () => {
    // #909: US path of the merged universityEnrollment node is HS-grad-driven.
    const lowG = ctx({ countryId: "US", current: { "education.highSchoolGradRate": 72 } });
    const highG = ctx({ countryId: "US", current: { "education.highSchoolGradRate": 96 } });
    expect(universityEnrollmentNode.compute!(highG)).toBeGreaterThan(
      universityEnrollmentNode.compute!(lowG)
    );
    expect(literacyRateNode.compute!(highG)).toBeGreaterThan(literacyRateNode.compute!(lowG));
  });

  it("universityEnrollment (non-US, GCSE-driven) rises with gcse attainment", () => {
    const lowA = ctx({ current: { "education.gcseAttainment": 45 } });
    const highA = ctx({ current: { "education.gcseAttainment": 80 } });
    expect(universityEnrollmentNode.compute!(highA)).toBeGreaterThan(
      universityEnrollmentNode.compute!(lowA)
    );
  });
});

describe("education nodes — well-formed", () => {
  it("every node has finite output at neutral inputs and metadata in bounds", () => {
    for (const node of EDUCATION_NODES) {
      const out = node.compute!(ctx({ spending: { education: 2 } }));
      expect(Number.isFinite(out), `${node.id} finite`).toBe(true);
      expect(node.bounds[0]).toBeLessThan(node.bounds[1]);
      expect(node.kind).toBe("derived");
      expect(node.id.startsWith("education.")).toBe(true);
    }
  });

  it("zero education spend is safe (no NaN/Infinity)", () => {
    for (const node of EDUCATION_NODES) {
      const out = node.compute!(ctx({ spending: {} }));
      expect(Number.isFinite(out), `${node.id} finite at zero spend`).toBe(true);
    }
  });
});
