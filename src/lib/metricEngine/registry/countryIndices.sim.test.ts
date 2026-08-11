import { describe, expect, it } from "vitest";
import { evalNode } from "../coexistence";
import type { EngineNodeContext, NodeId } from "../types";
import { GOVERNANCE_NODES } from "./governance";
import { MEDIA_INFORMATION_NODES } from "./mediaInformation";
import { incomeInequalityNode, socialCohesionNode } from "./social";
import { topoSort } from "../topoSort";

const TPY = 48;

/**
 * P5 country-indices dynamics: convergence with the legitimacy tier attached,
 * the defense-investment response, the demographic-aging pension response, the
 * publicTrust → devolution chain, and the migration-surge
 * response. Approval is held external (the loop itself is P4-proven).
 */
const CLUSTER = topoSort([
  ...GOVERNANCE_NODES,
  ...MEDIA_INFORMATION_NODES,
  incomeInequalityNode,
  socialCohesionNode,
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
        providers: { governmentApproval: 47 },
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
  "governance.governmentTransparency": 55,
  "mediaInformation.pressFreedom": 69,
  "population.dependencyRatio": 0.58,
  "population.migrationRate": 0.4,
  "economic.manufacturingCompetitiveness": 62,
  "economic.rdIntensity": 2.6,
  "population.urbanizationRate": 58,
};

const seed = {
  "social.incomeInequality": 41,
  "social.socialCohesion": 51,
  "mediaInformation.socialMediaSentiment": -2,
  "mediaInformation.mediaPolarization": 46,
  "mediaInformation.newsTrust": 49,
  "mediaInformation.disinformationRisk": 43,
  "mediaInformation.bbcTrust": 52,
  "governance.corruptionIndex": 39,
  "governance.publicTrust": 51,
  "governance.devolutionSatisfaction": 52,
  "governance.unityReferendumSupport": 42,
  "governance.rentenStabilitaet": 65,
  "governance.bundeswehrReadiness": 55,
  "governance.roboticsAdoption": 58,
  "governance.directProvisionLoad": 85,
};

// social: 2703 ~= the real US federal socialSecurity per-capita baseline
// ($900B / 333M pop, src/lib/seeds/reference/budgets.ts). Governance nodes
// (rentenStabilitaet, militaryReadiness) share SOCIAL_SPEND_HALF_SAT=2700
// with the social/publicSafety/economic tiers (ticket #826 item 14
// follow-up) — use realistic magnitudes, not the old toy scale (was 2).
const BASE_SPEND = { defense: 2.5, social: 2703 };

describe("P5 country-indices dynamics", () => {
  it("converges with the legitimacy tier attached", () => {
    const atFour = runTier(freshTier(seed), 4 * TPY, BASE_SPEND, external);
    const atEight = runTier(atFour, 4 * TPY, BASE_SPEND, external);
    for (const n of CLUSTER) {
      const v4 = atFour.value[n.id];
      expect(Number.isFinite(v4), `${n.id} finite`).toBe(true);
      expect(v4).toBeGreaterThanOrEqual(n.bounds[0]);
      expect(v4).toBeLessThanOrEqual(n.bounds[1]);
      expect(Math.abs(atEight.value[n.id] - v4), `${n.id} steady (${v4})`).toBeLessThan(0.6);
    }
  });

  it("a defense buildup raises readiness (capacity, diminishing)", () => {
    const warm = runTier(freshTier(seed), 4 * TPY, BASE_SPEND, external);
    const held = runTier(warm, 6 * TPY, BASE_SPEND, external);
    const buildup = runTier(warm, 6 * TPY, { ...BASE_SPEND, defense: 30 }, external);
    expect(buildup.value["governance.bundeswehrReadiness"]).toBeGreaterThan(
      held.value["governance.bundeswehrReadiness"]
    );
  });

  it("demographic aging erodes pension stability; pension funding cushions it", () => {
    const warm = runTier(freshTier(seed), 4 * TPY, BASE_SPEND, external);
    const held = runTier(warm, 6 * TPY, BASE_SPEND, external);
    const aged = runTier(warm, 6 * TPY, BASE_SPEND, {
      ...external,
      "population.dependencyRatio": 0.72,
    });
    const agedFunded = runTier(
      warm,
      6 * TPY,
      { ...BASE_SPEND, social: 5303 },
      { ...external, "population.dependencyRatio": 0.72 }
    );
    expect(aged.value["governance.rentenStabilitaet"]).toBeLessThan(
      held.value["governance.rentenStabilitaet"]
    );
    expect(agedFunded.value["governance.rentenStabilitaet"]).toBeGreaterThan(
      aged.value["governance.rentenStabilitaet"]
    );
  });

  it("the trust → devolution chain: a corruption shock erodes devolution satisfaction", () => {
    const warm = runTier(freshTier(seed), 4 * TPY, BASE_SPEND, external);
    const held = runTier(warm, 6 * TPY, BASE_SPEND, external);
    // Transparency collapse → corruption up → publicTrust down → devolution
    // satisfaction down, all through live edges. (independenceDesire is no longer a
    // registry node — it is owned by the drift engine, so the chain terminates here.)
    const scandal = runTier(warm, 6 * TPY, BASE_SPEND, {
      ...external,
      "governance.governmentTransparency": 25,
    });
    expect(scandal.value["governance.corruptionIndex"]).toBeGreaterThan(
      held.value["governance.corruptionIndex"]
    );
    expect(scandal.value["governance.publicTrust"]).toBeLessThan(
      held.value["governance.publicTrust"]
    );
    expect(scandal.value["governance.devolutionSatisfaction"]).toBeLessThan(
      held.value["governance.devolutionSatisfaction"]
    );
  });

  it("a migration surge strains direct provision; social capacity relieves it", () => {
    const warm = runTier(freshTier(seed), 4 * TPY, BASE_SPEND, external);
    const held = runTier(warm, 6 * TPY, BASE_SPEND, external);
    const surge = runTier(warm, 6 * TPY, BASE_SPEND, {
      ...external,
      "population.migrationRate": 1.6,
    });
    const surgeFunded = runTier(
      warm,
      6 * TPY,
      { ...BASE_SPEND, social: 5303 },
      { ...external, "population.migrationRate": 1.6 }
    );
    expect(surge.value["governance.directProvisionLoad"]).toBeGreaterThan(
      held.value["governance.directProvisionLoad"]
    );
    expect(surgeFunded.value["governance.directProvisionLoad"]).toBeLessThan(
      surge.value["governance.directProvisionLoad"]
    );
  });
});
