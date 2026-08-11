import { describe, expect, it } from "vitest";
import { evalNode } from "../coexistence";
import type { EngineNodeContext, NodeId } from "../types";
import { PUBLIC_SAFETY_NODES } from "./publicSafety";
import { SOCIAL_NODES } from "./social";
import { medianIncomeNode, costOfLivingNode, povertyRateNode } from "./economic";
import { EDUCATION_NODES } from "./education";
import { topoSort } from "../topoSort";

const TPY = 48;

/**
 * P3b loop dynamics — the poverty↔crime TWO-WAY LAGGED cycle goes live here
 * (povertyRate reads lagged crimeRate; crimeRate reads lagged povertyRate).
 * The co-sim runs the full income/poverty + education + publicSafety cluster:
 * convergence (incl. from a perturbed high-poverty/high-crime start), police
 * investment flowing crime→poverty through the lag, and social investment
 * flowing poverty→crime the other way.
 */
const CLUSTER = topoSort([
  ...PUBLIC_SAFETY_NODES,
  ...SOCIAL_NODES,
  medianIncomeNode,
  costOfLivingNode,
  povertyRateNode,
  ...EDUCATION_NODES,
]);

interface TierState {
  value: Record<NodeId, number>;
  baseline: Record<NodeId, number>;
}

function freshTier(seed: Record<string, number>): TierState {
  const value: Record<NodeId, number> = {};
  for (const n of CLUSTER) value[n.id] = seed[n.id] ?? (n.bounds[0] + n.bounds[1]) / 2;
  return { value, baseline: {} };
}

function runTier(
  state: TierState,
  turns: number,
  spending: Record<string, number>,
  external: Record<NodeId, number>
): TierState {
  const value = { ...state.value };
  const baseline = { ...state.baseline };
  for (let t = 0; t < turns; t++) {
    const current: Record<NodeId, number> = { ...external };
    for (const n of CLUSTER) {
      const ctx: EngineNodeContext = {
        current,
        prev: { ...value, ...external },
        prevSimBaseline: baseline,
        providers: {},
        spending,
        policyValue: value[n.id],
      };
      const r = evalNode(n, ctx, "sim");
      value[n.id] = r.value;
      baseline[n.id] = r.simBaseline;
      current[n.id] = r.value;
    }
  }
  return { value, baseline };
}

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

const seed = {
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

// Real per-capita $ figures (not toy 1-30 units), each channel at its own
// realistic baseline:
//  - publicSafety $829: center of the $418-$1935/capita achievable range
//    (cheapest to priciest option across every publicSafety bill) — see
//    PS_SPEND_HALF_SAT's doc comment in ./publicSafety.ts.
//  - social $2703: the real US federal socialSecurity per-capita baseline
//    ($900B / 333M pop, src/lib/seeds/reference/budgets.ts). recidivismRate
//    (a publicSafety node) reads the social channel and shares
//    SOCIAL_SPEND_HALF_SAT=2700 with the social/governance/economic tiers.
// (education is an unused input for the publicSafety nodes under test; kept
// at its prior placeholder.)
const BASE_SPEND = { social: 2703, education: 2, publicSafety: 829 };

describe("P3b poverty↔crime loop dynamics", () => {
  it("the full cluster converges with the two-way lagged loop live", () => {
    const atFour = runTier(freshTier(seed), 4 * TPY, BASE_SPEND, external);
    const atEight = runTier(atFour, 4 * TPY, BASE_SPEND, external);
    for (const n of CLUSTER) {
      if (n.id === "economic.medianIncome") continue; // grows by design (relative form)
      const v4 = atFour.value[n.id];
      expect(Number.isFinite(v4), `${n.id} finite`).toBe(true);
      expect(v4).toBeGreaterThanOrEqual(n.bounds[0]);
      expect(v4).toBeLessThanOrEqual(n.bounds[1]);
      // crime-scale nodes get a proportionally coarser steadiness tolerance.
      const tol = n.id === "publicSafety.crimeRate" ? 60 : n.bounds[1] > 1000 ? 10 : 0.6;
      expect(Math.abs(atEight.value[n.id] - v4), `${n.id} steady (${v4})`).toBeLessThan(tol);
    }
  });

  it("converges (damped, no oscillation) from a perturbed high-poverty/high-crime start", () => {
    const shocked = freshTier({
      ...seed,
      "economic.povertyRate": 25,
      "publicSafety.crimeRate": 9000,
      "social.childPoverty": 32,
    });
    // NOTE the coexistence contract: a seeded shock is a preserved POLICY DELTA
    // (the seed governs the level), so the system settles at an ELEVATED
    // equilibrium — the loop must not amplify it, but it does not decay back to
    // the reference basin (that's the live policyEffects loop's job).
    const atFour = runTier(shocked, 4 * TPY, BASE_SPEND, external);
    const atSix = runTier(atFour, 2 * TPY, BASE_SPEND, external);
    const atEight = runTier(atSix, 2 * TPY, BASE_SPEND, external);
    // Monotone settling, not oscillation: successive 2-year deltas shrink.
    const d1 = Math.abs(
      atSix.value["publicSafety.crimeRate"] - atFour.value["publicSafety.crimeRate"]
    );
    const d2 = Math.abs(
      atEight.value["publicSafety.crimeRate"] - atSix.value["publicSafety.crimeRate"]
    );
    expect(d2).toBeLessThanOrEqual(d1 + 1);
    const p1 = Math.abs(atSix.value["economic.povertyRate"] - atFour.value["economic.povertyRate"]);
    const p2 = Math.abs(
      atEight.value["economic.povertyRate"] - atSix.value["economic.povertyRate"]
    );
    expect(p2).toBeLessThanOrEqual(p1 + 0.05);
    // No amplification: the loop gain is « 1, so the joint equilibrium stays
    // bounded near the shocked start instead of running away.
    expect(atEight.value["publicSafety.crimeRate"]).toBeLessThan(11500);
    expect(atEight.value["economic.povertyRate"]).toBeLessThan(28);
    expect(atEight.value["publicSafety.crimeRate"]).toBeGreaterThan(4500);
  });

  it("police investment cuts crime, lifts confidence, and (via the lag) lowers poverty", () => {
    const warm = runTier(freshTier(seed), 4 * TPY, BASE_SPEND, external);
    const held = runTier(warm, 6 * TPY, BASE_SPEND, external);
    // $1935/capita = the real max (priciest option on every publicSafety bill).
    const invested = runTier(warm, 6 * TPY, { ...BASE_SPEND, publicSafety: 1935 }, external);

    expect(invested.value["publicSafety.policePerCapita"]).toBeGreaterThan(
      held.value["publicSafety.policePerCapita"]
    );
    // Meaningful variation, not a rounding-noise bump: raising spend from the
    // $829/capita center to the $1935/capita max should move policePerCapita
    // by well over half a point (out of its 0-20 bound) now that the funding
    // response has real slope across that range (PS_SPEND_HALF_SAT=900).
    expect(
      invested.value["publicSafety.policePerCapita"] - held.value["publicSafety.policePerCapita"]
    ).toBeGreaterThan(0.4);
    expect(invested.value["publicSafety.crimeRate"]).toBeLessThan(
      held.value["publicSafety.crimeRate"]
    );
    expect(invested.value["publicSafety.publicSafetyConfidence"]).toBeGreaterThan(
      held.value["publicSafety.publicSafetyConfidence"]
    );
    // The crime→poverty lagged edge.
    expect(invested.value["economic.povertyRate"]).toBeLessThan(held.value["economic.povertyRate"]);
  });

  it("social investment lowers poverty AND (via the lag) crime — the other direction", () => {
    const warm = runTier(freshTier(seed), 4 * TPY, BASE_SPEND, external);
    const held = runTier(warm, 6 * TPY, BASE_SPEND, external);
    // 5303 = the richest real policy option (Universal Social Security
    // Expansion Act, legislationTypes.ts annualCostPerCapita).
    const invested = runTier(warm, 6 * TPY, { ...BASE_SPEND, social: 5303 }, external);

    expect(invested.value["economic.povertyRate"]).toBeLessThan(held.value["economic.povertyRate"]);
    expect(invested.value["publicSafety.crimeRate"]).toBeLessThan(
      held.value["publicSafety.crimeRate"]
    );
    // Downstream: less crime + social support → less recidivism.
    expect(invested.value["publicSafety.recidivismRate"]).toBeLessThan(
      held.value["publicSafety.recidivismRate"]
    );
  });
});
