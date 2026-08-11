import { describe, expect, it } from "vitest";
import { PUBLIC_SAFETY_NODES } from "./publicSafety";
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
 * Legislative metric simulation — PUBLIC SAFETY category, 240 turns.
 *
 * Law: "Law Enforcement & Criminal Justice Act" (us_law_enforcement_criminal_justice),
 * high-investment option (+1). Public-safety outcome nodes read
 * `spending.publicSafety`; the poverty↔crime cluster (social + income/poverty +
 * education) runs alongside so the lagged loop is live. Enacting the law = raising
 * the public-safety spend from the real per-capita MIN to MAX ($418 → $1935,
 * the cheapest vs priciest option summed across every publicSafety bill — see
 * PS_SPEND_HALF_SAT's doc comment in ./publicSafety.ts). Expected: more police,
 * less crime, more confidence.
 */
const TURNS = 240;
const TPY = 48;

const CLUSTER = topoSort([
  ...PUBLIC_SAFETY_NODES,
  ...SOCIAL_NODES,
  medianIncomeNode,
  costOfLivingNode,
  povertyRateNode,
  ...EDUCATION_NODES,
]);

const law = legislationTypes.find((l) => l._id === "us_law_enforcement_criminal_justice");
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
  "publicSafety.crimeRate": 4500,
  "publicSafety.violentCrimeRate": 250,
  "publicSafety.policePerCapita": 2.5,
  "publicSafety.incarcerationRate": 450,
  "publicSafety.recidivismRate": 43,
  "publicSafety.publicSafetyConfidence": 58,
  "publicSafety.antiSocialBehaviourRate": 5.6,
  "publicSafety.knifeCrimeRate": 2.5,
};

// policePerCapita responds directly to the public-safety spend; publicSafetyConfidence
// moves only slowly/indirectly (via crime + cohesion), so we don't assert on it here.
const HIGHER_BETTER: NodeId[] = ["publicSafety.policePerCapita"];
const LOWER_BETTER: NodeId[] = ["publicSafety.crimeRate"];

describe("legislation sim — public safety (Law Enforcement & Criminal Justice Act, 240 turns)", () => {
  it("the seed law and its high-investment option exist", () => {
    expect(law, "us_law_enforcement_criminal_justice present").toBeTruthy();
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
  const warm = warmup({ ...common, policies: [], spending: { publicSafety: 418 } });
  const control = runLegislationSim(
    { ...common, policies: [], spending: { publicSafety: 418 } },
    warm
  );
  const enacted = runLegislationSim(
    { ...common, policies: [], spending: { publicSafety: 1935 } },
    warm
  );

  it("prints the 240-turn trajectory report", () => {
    console.log(
      reportTrajectory(
        "Public Safety — Law Enforcement & Criminal Justice Act",
        [...HIGHER_BETTER, ...LOWER_BETTER],
        control,
        enacted
      )
    );
    expect(true).toBe(true);
  });

  it("more police vs the no-law control", () => {
    for (const id of HIGHER_BETTER) {
      expect(
        enacted.final[id],
        `${id}: law ${enacted.final[id]} > control ${control.final[id]}`
      ).toBeGreaterThan(control.final[id]);
    }
  });

  it("moves policePerCapita by a meaningful amount, not a near-saturation rounding bump", () => {
    // Real MIN → MAX per-capita spend ($418 → $1935) should now swing
    // policePerCapita by well over half a point (out of its 0-20 bound) —
    // under the old HALF_SAT=1 this whole range was >99.7% saturated and the
    // move was barely perceptible.
    const delta =
      enacted.final["publicSafety.policePerCapita"] - control.final["publicSafety.policePerCapita"];
    expect(delta).toBeGreaterThan(0.5);
  });

  it("crime falls below the no-law control", () => {
    for (const id of LOWER_BETTER) {
      expect(
        enacted.final[id],
        `${id}: law ${enacted.final[id]} < control ${control.final[id]}`
      ).toBeLessThan(control.final[id]);
    }
  });

  it("public-safety nodes stay within bounds and converge (stable tail)", () => {
    for (const n of PUBLIC_SAFETY_NODES) {
      const v = enacted.final[n.id];
      expect(Number.isFinite(v), `${n.id} finite`).toBe(true);
      expect(v, `${n.id} >= lower`).toBeGreaterThanOrEqual(n.bounds[0]);
      expect(v, `${n.id} <= upper`).toBeLessThanOrEqual(n.bounds[1]);
      const tail = enacted.trajectory[n.id].slice(-TPY);
      // Relative tolerance: crime/incarceration metrics are in the hundreds/thousands.
      expect(Math.max(...tail) - Math.min(...tail), `${n.id} converged`).toBeLessThan(
        Math.max(1.0, 0.02 * Math.abs(v))
      );
    }
  });
});
