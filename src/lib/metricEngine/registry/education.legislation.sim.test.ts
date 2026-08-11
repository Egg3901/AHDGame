import { describe, expect, it } from "vitest";
import { EDUCATION_NODES } from "./education";
import { legislationTypes } from "@/lib/seeds/reference/legislationTypes";
import {
  runLegislationSim,
  warmup,
  enactedLaw,
  reportTrajectory,
} from "../__sims__/legislationSim";
import type { NodeId } from "../types";
import type { StateMetricBaseline } from "@/lib/db/types/statePolicy";

/**
 * Legislative metric simulation — EDUCATION category, 240 turns.
 *
 * Law: "Federal Education Investment Act" (us_federal_education_funding), the
 * highest-investment option (effectDirection +1). A funding law works through the
 * education BUDGET (budgetCategory: education) — the outcome nodes read
 * `spending.education` directly — so enacting it is modelled as the spend rising from
 * today's realistic US federal baseline ($806/capita) to that baseline plus the
 * bill's own top-option per-capita cost ($1303, its "Universal Public Education
 * Expansion Act" option — src/lib/seeds/reference/legislationTypes.ts
 * us_federal_education_funding), i.e. $806 -> $2109/capita. See the
 * EDU_SPEND_HALF_SAT comment in ./education for how these figures were derived.
 * Control (no law, baseline spend) runs beside it; divergence isolates the law.
 */
const TURNS = 240;
const TPY = 48;

const law = legislationTypes.find((l) => l._id === "us_federal_education_funding");
const invest = law?.policyOptions?.find((o) => o.effectDirection === 1);

const baselineDoc: StateMetricBaseline = {
  _id: "federal",
  baselines: {},
} as unknown as StateMetricBaseline;

const external: Record<NodeId, number> = {
  "social.childPoverty": 18,
  "social.socialCohesion": 55,
  "economic.medianIncome": 52_000,
  "education.academicPressure": 50,
  "education.apprenticeshipRate": 3,
};

const HIGHER_BETTER: NodeId[] = [
  "education.highSchoolGradRate",
  "education.testPerformance",
  "education.literacyRate",
  "education.gcseAttainment",
];

describe("legislation sim — education (Federal Education Investment Act, 240 turns)", () => {
  it("the seed law and its top-investment option exist", () => {
    expect(law, "us_federal_education_funding present").toBeTruthy();
    expect(invest, "an investment (effectDirection +1) option exists").toBeTruthy();
  });

  const { legTypeMap } = enactedLaw(law!, { effectDirection: 1, policyOptionId: invest?.id });
  const common = {
    nodes: EDUCATION_NODES,
    baselineDoc,
    external,
    providers: {},
    legTypeMap,
    turns: TURNS,
  };
  const warm = warmup({ ...common, policies: [], spending: { education: 806 } });
  const control = runLegislationSim(
    { ...common, policies: [], spending: { education: 806 } },
    warm
  );
  const enacted = runLegislationSim(
    { ...common, policies: [], spending: { education: 2109 } },
    warm
  );

  it("prints the 240-turn trajectory report", () => {
    console.log(
      reportTrajectory(
        "Education — Federal Education Investment Act",
        HIGHER_BETTER,
        control,
        enacted
      )
    );
    expect(true).toBe(true);
  });

  it("higher-better education outcomes end ABOVE the no-law control", () => {
    for (const id of HIGHER_BETTER) {
      expect(
        enacted.final[id],
        `${id}: law ${enacted.final[id]} > control ${control.final[id]}`
      ).toBeGreaterThan(control.final[id]);
      // Meaningful, not a sliver — the bug this recalibration fixes (ticket
      // #826 item 14) was bills barely moving their target metric because the
      // old halfSat=1 saturated the response near its ceiling at any realistic
      // spend, so control and enacted were nearly indistinguishable.
      expect(
        enacted.final[id] - control.final[id],
        `${id}: enacted-vs-control spread should be meaningful`
      ).toBeGreaterThan(0.5);
    }
  });

  it("every node stays within bounds and converges (stable tail)", () => {
    for (const n of EDUCATION_NODES) {
      const v = enacted.final[n.id];
      expect(Number.isFinite(v), `${n.id} finite`).toBe(true);
      expect(v, `${n.id} >= lower`).toBeGreaterThanOrEqual(n.bounds[0]);
      expect(v, `${n.id} <= upper`).toBeLessThanOrEqual(n.bounds[1]);
      const tail = enacted.trajectory[n.id].slice(-TPY);
      expect(Math.max(...tail) - Math.min(...tail), `${n.id} converged`).toBeLessThan(1.0);
    }
  });
});
