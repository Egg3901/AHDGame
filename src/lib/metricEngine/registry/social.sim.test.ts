import { describe, expect, it } from "vitest";
import { evalNode } from "../coexistence";
import type { EngineNodeContext, NodeId } from "../types";
import { SOCIAL_NODES } from "./social";
import { medianIncomeNode, costOfLivingNode, povertyRateNode } from "./economic";
import { EDUCATION_NODES } from "./education";
import { topoSort } from "../topoSort";

const TPY = 48;

/**
 * P3a cluster dynamics: convergence at constant inputs, social-spend response,
 * and the poverty→education LAGGED loop (childPoverty feeds gradRate /
 * testPerformance next turn) — the whole chain must converge, and sustained
 * social investment must lift schooling outcomes through reduced child poverty.
 */
const CLUSTER = topoSort([
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
  "publicSafety.crimeRate": 4500,
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
};

describe("P3a cluster dynamics", () => {
  it("converges with the education tier attached (no divergence/oscillation)", () => {
    // social: 2703 ~= the real US federal socialSecurity per-capita baseline
    // ($900B / 333M pop, src/lib/seeds/reference/budgets.ts) — the
    // SOCIAL_SPEND_HALF_SAT=2700 recalibration (ticket #826 item 14 follow-up)
    // means this channel now has real slope in the $0-$5,303/capita range a
    // player can actually reach via `us_social_security`, so fixtures use
    // realistic magnitudes instead of the old toy scale (was social: 3).
    const spend = { social: 2703, education: 2 };
    const atFour = runTier(freshTier(seed), 4 * TPY, spend, external);
    const atEight = runTier(atFour, 4 * TPY, spend, external);
    for (const n of CLUSTER) {
      if (n.id === "economic.medianIncome") continue; // grows by design (relative form)
      const v4 = atFour.value[n.id];
      expect(Number.isFinite(v4), `${n.id} finite`).toBe(true);
      expect(v4).toBeGreaterThanOrEqual(n.bounds[0]);
      expect(v4).toBeLessThanOrEqual(n.bounds[1]);
      expect(Math.abs(atEight.value[n.id] - v4), `${n.id} steady (${v4})`).toBeLessThan(0.6);
    }
    // medianIncome grows steadily, not explosively (~1.2%/yr at reference).
    const growth4to8 =
      atEight.value["economic.medianIncome"] / atFour.value["economic.medianIncome"];
    expect(growth4to8).toBeGreaterThan(1.0);
    expect(growth4to8).toBeLessThan(1.2); // ≤ ~4.6%/yr over 4 years
  });

  it("raising social spending lowers poverty, child poverty, AND (via the lag) lifts schooling", () => {
    // 2703 = real seed-default per-capita baseline (do-nothing); 5303 = the
    // richest real policy option (Universal Social Security Expansion Act,
    // legislationTypes.ts annualCostPerCapita). Real range, not toy values.
    const warm = runTier(freshTier(seed), 4 * TPY, { social: 2703, education: 2 }, external);
    const held = runTier(warm, 6 * TPY, { social: 2703, education: 2 }, external);
    const invested = runTier(warm, 6 * TPY, { social: 5303, education: 2 }, external);

    expect(invested.value["economic.povertyRate"]).toBeLessThan(held.value["economic.povertyRate"]);
    expect(invested.value["social.childPoverty"]).toBeLessThan(held.value["social.childPoverty"]);
    expect(invested.value["social.incomeInequality"]).toBeLessThan(
      held.value["social.incomeInequality"]
    );
    // The poverty→education lagged loop: less child poverty → better schooling.
    expect(invested.value["education.highSchoolGradRate"]).toBeGreaterThan(
      held.value["education.highSchoolGradRate"]
    );
    expect(invested.value["education.testPerformance"]).toBeGreaterThan(
      held.value["education.testPerformance"]
    );
  });
});
