import { describe, expect, it } from "vitest";
import { evalNode } from "../coexistence";
import type { EngineNodeContext, NodeId } from "../types";
import { SOCIAL_NODES } from "./social";
import { medianIncomeNode, costOfLivingNode, povertyRateNode } from "./economic";
import { EDUCATION_NODES } from "./education";
import { topoSort } from "../topoSort";

const TPY = 48;

/**
 * P3d cluster dynamics — the housing chain (supply root → pressure →
 * homelessness → roughSleeping, IE rental/vacancy) and the cohesion hand-back
 * (socialCohesion now feeds education.highSchoolGradRate as a live same-turn
 * edge): convergence + both directions of response.
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
  "economic.rdIntensity": 2.5,
  "education.academicPressure": 50,
  "education.apprenticeshipRate": 3,
  "mediaInformation.mediaPolarization": 45,
  "governance.publicTrust": 50,
  "social.housingSupplyGrowth": 1,
  "healthcare.mentalHealthAccess": 50,
};

const seed = {
  "economic.medianIncome": 52_000,
  "economic.costOfLiving": 104,
  "economic.povertyRate": 12.5,
  "social.incomeInequality": 41,
  "social.childPoverty": 17,
  "social.foodInsecurity": 10.5,
  "social.housingAffordability": 33,
  "social.homelessnessRate": 14,
  "social.socialMobility": 56,
  "social.socialCohesion": 51,
  "social.civicParticipation": 57,
  "social.roughSleeping": 2.8,
  "social.vacantPropertyRate": 9,
  "social.rentalPressureIndex": 72,
};

// social: 2703 ~= the real US federal socialSecurity per-capita baseline
// ($900B / 333M pop). SOCIAL_SPEND_HALF_SAT=2700 (ticket #826 item 14
// follow-up) gives this channel real slope across the $0-$5,303/capita
// range a player can reach via `us_social_security` — use realistic
// magnitudes instead of the old toy scale (was social: 3).
const BASE_SPEND = { social: 2703, education: 2 };

describe("P3d social-outcomes cluster dynamics", () => {
  it("converges with housing + cohesion + education attached", () => {
    const atFour = runTier(freshTier(seed), 4 * TPY, BASE_SPEND, external);
    const atEight = runTier(atFour, 4 * TPY, BASE_SPEND, external);
    for (const n of CLUSTER) {
      if (n.id === "economic.medianIncome") continue; // grows by design (relative form)
      const v4 = atFour.value[n.id];
      expect(Number.isFinite(v4), `${n.id} finite`).toBe(true);
      expect(v4).toBeGreaterThanOrEqual(n.bounds[0]);
      expect(v4).toBeLessThanOrEqual(n.bounds[1]);
      expect(Math.abs(atEight.value[n.id] - v4), `${n.id} steady (${v4})`).toBeLessThan(0.6);
    }
  });

  it("a housebuilding push relieves the whole housing chain (and IE variants)", () => {
    const warm = runTier(freshTier(seed), 4 * TPY, BASE_SPEND, external);
    const held = runTier(warm, 6 * TPY, BASE_SPEND, external);
    const building = runTier(warm, 6 * TPY, BASE_SPEND, {
      ...external,
      "social.housingSupplyGrowth": 4,
    });

    expect(building.value["social.housingAffordability"]).toBeLessThan(
      held.value["social.housingAffordability"]
    );
    expect(building.value["social.homelessnessRate"]).toBeLessThan(
      held.value["social.homelessnessRate"]
    );
    expect(building.value["social.roughSleeping"]).toBeLessThan(held.value["social.roughSleeping"]);
    expect(building.value["social.rentalPressureIndex"]).toBeLessThan(
      held.value["social.rentalPressureIndex"]
    );
    expect(building.value["social.vacantPropertyRate"]).toBeGreaterThan(
      held.value["social.vacantPropertyRate"]
    );
  });

  it("the cohesion hand-back: social investment lifts cohesion AND schooling through it", () => {
    const warm = runTier(freshTier(seed), 4 * TPY, BASE_SPEND, external);
    const held = runTier(warm, 6 * TPY, BASE_SPEND, external);
    // 5303 = the richest real policy option (Universal Social Security
    // Expansion Act, legislationTypes.ts annualCostPerCapita).
    const invested = runTier(warm, 6 * TPY, { ...BASE_SPEND, social: 5303 }, external);

    // social channel → inequality down → cohesion up (same-turn) → gradRate up.
    expect(invested.value["social.incomeInequality"]).toBeLessThan(
      held.value["social.incomeInequality"]
    );
    expect(invested.value["social.socialCohesion"]).toBeGreaterThan(
      held.value["social.socialCohesion"]
    );
    expect(invested.value["education.highSchoolGradRate"]).toBeGreaterThan(
      held.value["education.highSchoolGradRate"]
    );
    expect(invested.value["social.socialMobility"]).toBeGreaterThan(
      held.value["social.socialMobility"]
    );
  });

  it("polarization erodes cohesion, participation, and (through the hand-back) schooling", () => {
    const warm = runTier(freshTier(seed), 4 * TPY, BASE_SPEND, external);
    const held = runTier(warm, 6 * TPY, BASE_SPEND, external);
    const polarized = runTier(warm, 6 * TPY, BASE_SPEND, {
      ...external,
      "mediaInformation.mediaPolarization": 70,
    });

    expect(polarized.value["social.socialCohesion"]).toBeLessThan(
      held.value["social.socialCohesion"]
    );
    expect(polarized.value["social.civicParticipation"]).toBeLessThan(
      held.value["social.civicParticipation"]
    );
    expect(polarized.value["education.highSchoolGradRate"]).toBeLessThan(
      held.value["education.highSchoolGradRate"]
    );
  });
});
