import { describe, expect, it } from "vitest";
import { evalNode } from "../coexistence";
import type { EngineNodeContext, NodeId } from "../types";
import {
  militaryReadinessNode,
  bundeswehrReadinessNode,
  civilLibertiesNode,
  nationalPrideNode,
} from "./governance";
import { economicFreedomNode } from "./economic";
import { crimeRateNode, incarcerationRateNode, policePerCapitaNode } from "./publicSafety";
import { topoSort } from "../topoSort";

const TPY = 48;

/**
 * P6a axis-node dynamics: defense buildup → readiness → pride (with the DE
 * tracker in lockstep); a security-state crackdown (state media + policing)
 * trades civilLiberties down through the LIVE incarceration chain; deregulation
 * lifts economicFreedom. Convergence throughout.
 */
const CLUSTER = topoSort([
  militaryReadinessNode,
  bundeswehrReadinessNode,
  civilLibertiesNode,
  nationalPrideNode,
  economicFreedomNode,
  policePerCapitaNode,
  crimeRateNode,
  incarcerationRateNode,
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
  "economic.gdpGrowth": 2.5,
  "economic.unemploymentRate": 5,
  "economic.povertyRate": 13,
  "education.highSchoolGradRate": 88,
  "social.incomeInequality": 42,
  "mediaInformation.pressFreedom": 69,
  "mediaInformation.stateMediaControl": 30,
  "governance.socialCreditCoverage": 10,
  "economic.regulatoryBurden": 50,
  "economic.smallBusinessFormation": 8,
};

const seed = {
  "governance.militaryReadiness": 50,
  "governance.bundeswehrReadiness": 50,
  "governance.civilLiberties": 50,
  "governance.nationalPride": 52,
  "economic.economicFreedom": 50,
  "publicSafety.policePerCapita": 2.5,
  "publicSafety.crimeRate": 4500,
  "publicSafety.incarcerationRate": 450,
};

const BASE_SPEND = { defense: 2, publicSafety: 1 };

describe("P6a axis-node dynamics", () => {
  it("converges at constant inputs", () => {
    const atFour = runTier(freshTier(seed), 4 * TPY, BASE_SPEND, external);
    const atEight = runTier(atFour, 4 * TPY, BASE_SPEND, external);
    for (const n of CLUSTER) {
      const v = atEight.value[n.id];
      expect(Number.isFinite(v), `${n.id} finite`).toBe(true);
      expect(v).toBeGreaterThanOrEqual(n.bounds[0]);
      expect(v).toBeLessThanOrEqual(n.bounds[1]);
      const tol = n.bounds[1] > 1000 ? 60 : 0.6;
      expect(Math.abs(atEight.value[n.id] - atFour.value[n.id]), `${n.id} steady`).toBeLessThan(
        tol
      );
    }
  });

  it("a defense buildup raises readiness and pride; the DE tracker follows in lockstep", () => {
    const warm = runTier(freshTier(seed), 4 * TPY, BASE_SPEND, external);
    const held = runTier(warm, 6 * TPY, BASE_SPEND, external);
    const buildup = runTier(warm, 6 * TPY, { ...BASE_SPEND, defense: 30 }, external);
    expect(buildup.value["governance.militaryReadiness"]).toBeGreaterThan(
      held.value["governance.militaryReadiness"]
    );
    expect(buildup.value["governance.nationalPride"]).toBeGreaterThan(
      held.value["governance.nationalPride"]
    );
    expect(
      Math.abs(
        buildup.value["governance.bundeswehrReadiness"] -
          buildup.value["governance.militaryReadiness"]
      )
    ).toBeLessThan(1);
  });

  it("a security-state turn (state media + mass policing) erodes civil liberties through live chains", () => {
    const warm = runTier(freshTier(seed), 4 * TPY, BASE_SPEND, external);
    const held = runTier(warm, 6 * TPY, BASE_SPEND, external);
    // State-media control up + heavy policing → more incarceration (via the
    // live police→crime→incarceration chain) + direct control term.
    const crackdown = runTier(
      warm,
      6 * TPY,
      { ...BASE_SPEND, publicSafety: 30 },
      { ...external, "mediaInformation.stateMediaControl": 65 }
    );
    expect(crackdown.value["governance.civilLiberties"]).toBeLessThan(
      held.value["governance.civilLiberties"]
    );
  });

  it("deregulation lifts economic freedom", () => {
    const warm = runTier(freshTier(seed), 4 * TPY, BASE_SPEND, external);
    const held = runTier(warm, 6 * TPY, BASE_SPEND, external);
    const deregulated = runTier(warm, 6 * TPY, BASE_SPEND, {
      ...external,
      "economic.regulatoryBurden": 30,
      "economic.smallBusinessFormation": 11,
    });
    expect(deregulated.value["economic.economicFreedom"]).toBeGreaterThan(
      held.value["economic.economicFreedom"]
    );
  });
});
