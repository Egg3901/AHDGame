import { describe, expect, it } from "vitest";
import { SOCIAL_NODES } from "./social";
import { medianIncomeNode, costOfLivingNode, povertyRateNode } from "./economic";
import { EDUCATION_NODES } from "./education";
import { topoSort } from "../topoSort";
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
 * Legislative metric simulation — SOCIAL category, 240 turns.
 *
 * Law: "Social Security & Welfare Act" (us_social_security), high-benefit option (+1,
 * "Universal Social Security Expansion Act", annualCostPerCapita 5303).
 * The social-cohesion/anti-poverty nodes read `spending.social`; the income/poverty +
 * education cluster runs alongside (poverty feeds inequality + child poverty).
 * Control = the unlegislated federal seed baseline (~$2,702.70/capita — NATIONAL_BUDGET_
 * SEED_CONFIGS US socialSecurity $900B / 333M pop, src/lib/seeds/reference/budgets.ts).
 * Enacted = the real per-capita cost of the +1 option (5303), matching
 * SOCIAL_SPEND_HALF_SAT=2700 (ticket #826 item 14 follow-up). Expected: less poverty,
 * less child poverty, less inequality.
 */
const TURNS = 240;
const TPY = 48;

const CLUSTER = topoSort([
  ...SOCIAL_NODES,
  medianIncomeNode,
  costOfLivingNode,
  povertyRateNode,
  ...EDUCATION_NODES,
]);

const law = legislationTypes.find((l) => l._id === "us_social_security");
const invest = law?.policyOptions?.find((o) => o.effectDirection === 1);

const baselineDoc: StateMetricBaseline = {
  _id: "federal",
  baselines: {},
} as unknown as StateMetricBaseline;

const external: Record<NodeId, number> = {
  "economic.unemploymentRate": 5,
  "economic.gdpGrowth": 2.5,
  "economic.productivityGrowth": 1.2,
  "economic.foodSecurity": 55,
  "population.urbanizationRate": 58,
  "social.socialCohesion": 52,
  "economic.rdIntensity": 2.5,
  "education.academicPressure": 50,
  "education.apprenticeshipRate": 3,
};
const initial: Partial<Record<NodeId, number>> = {
  "economic.medianIncome": 52_000,
  "economic.costOfLiving": 104,
  "economic.povertyRate": 12.5,
  "social.incomeInequality": 41,
  "social.childPoverty": 17,
  "social.foodInsecurity": 10.5,
};

// Lower-better social-tier outcomes that respond to social spending (poverty pathway).
const LOWER_BETTER: NodeId[] = [
  "social.childPoverty",
  "social.incomeInequality",
  "economic.povertyRate",
];

describe("legislation sim — social (Social Security & Welfare Act, 240 turns)", () => {
  it("the seed law and its high-benefit option exist", () => {
    expect(law, "us_social_security present").toBeTruthy();
    expect(invest, "an investment (+1) option exists").toBeTruthy();
  });

  const { legTypeMap } = enactedLaw(law!, { effectDirection: 1, policyOptionId: invest?.id });
  const common = {
    nodes: CLUSTER,
    baselineDoc,
    external,
    initial,
    providers: {},
    legTypeMap,
    turns: TURNS,
  };
  const warm = warmup({ ...common, policies: [], spending: { social: 2703, education: 2 } });
  const control = runLegislationSim(
    { ...common, policies: [], spending: { social: 2703, education: 2 } },
    warm
  );
  const enacted = runLegislationSim(
    { ...common, policies: [], spending: { social: 5303, education: 2 } },
    warm
  );

  it("prints the 240-turn trajectory report", () => {
    console.log(
      reportTrajectory("Social — Social Security & Welfare Act", LOWER_BETTER, control, enacted)
    );
    expect(true).toBe(true);
  });

  it("poverty, child poverty, and inequality all fall below the no-law control", () => {
    for (const id of LOWER_BETTER) {
      expect(
        enacted.final[id],
        `${id}: law ${enacted.final[id]} < control ${control.final[id]}`
      ).toBeLessThan(control.final[id]);
    }
  });

  it("social nodes stay within bounds and converge (stable tail)", () => {
    for (const n of SOCIAL_NODES) {
      const v = enacted.final[n.id];
      expect(Number.isFinite(v), `${n.id} finite`).toBe(true);
      expect(v, `${n.id} >= lower`).toBeGreaterThanOrEqual(n.bounds[0]);
      expect(v, `${n.id} <= upper`).toBeLessThanOrEqual(n.bounds[1]);
      const tail = enacted.trajectory[n.id].slice(-TPY);
      expect(Math.max(...tail) - Math.min(...tail), `${n.id} converged`).toBeLessThan(
        Math.max(1.0, 0.02 * Math.abs(v))
      );
    }
  });
});
