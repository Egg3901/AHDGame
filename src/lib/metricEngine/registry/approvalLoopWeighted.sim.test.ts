import { describe, expect, it } from "vitest";
import { evalNode } from "../coexistence";
import type { EngineNodeContext, NodeId } from "../types";
import { MEDIA_INFORMATION_NODES } from "./mediaInformation";
import { GOVERNANCE_NODES } from "./governance";
import { incomeInequalityNode } from "./social";
import { topoSort } from "../topoSort";
import {
  computeStateApprovalBase,
  computeNationalAveragesFromMetrics,
} from "@/lib/utils/governmentApproval";
import type { StateDemographicGroup } from "@/lib/db/types/demographics";

const TPY = 48;

/**
 * P6d GATE 4 — the P4 approval feedback loop must stay damped with the 2D
 * electorate weighting ACTIVE (not just the ideology-blind average). Same
 * closed loop as governanceMedia.sim, but approval is recomputed with a
 * polarized electorate's groups each turn. The weighting reshapes the
 * equilibrium but must not introduce oscillation or runaway.
 */
const CLUSTER = topoSort([...MEDIA_INFORMATION_NODES, ...GOVERNANCE_NODES, incomeInequalityNode]);

const GROUPS: StateDemographicGroup[] = [
  { population: 55, economicLean: 4, socialLean: 4 }, // conservative bloc
  { population: 45, economicLean: -2, socialLean: -2 }, // progressive bloc
];

interface LoopState {
  value: Record<NodeId, number>;
  baseline: Record<NodeId, number>;
  approval: number;
  trace: number[];
}

function fresh(seed: Record<string, number>, approval: number): LoopState {
  const value: Record<NodeId, number> = {};
  for (const n of CLUSTER) value[n.id] = seed[n.id] ?? (n.bounds[0] + n.bounds[1]) / 2;
  return { value, baseline: {}, approval, trace: [approval] };
}

function approvalFromMetrics(
  value: Record<NodeId, number>,
  external: Record<NodeId, number>
): number {
  const doc = {
    _id: "sim",
    economic: { unemploymentRate: { value: external["economic.unemploymentRate"] ?? 5 } },
    social: { incomeInequality: { value: value["social.incomeInequality"] ?? 42 } },
    governance: {
      governmentTransparency: { value: external["governance.governmentTransparency"] ?? 55 },
      corruptionIndex: { value: value["governance.corruptionIndex"] ?? 40 },
      publicTrust: { value: value["governance.publicTrust"] ?? 50 },
    },
    mediaInformation: {
      pressFreedom: { value: external["mediaInformation.pressFreedom"] ?? 69 },
      mediaPolarization: { value: value["mediaInformation.mediaPolarization"] ?? 45 },
      newsTrust: { value: value["mediaInformation.newsTrust"] ?? 50 },
      disinformationRisk: { value: value["mediaInformation.disinformationRisk"] ?? 42 },
      socialMediaSentiment: { value: value["mediaInformation.socialMediaSentiment"] ?? 0 },
    },
  };
  const averages = computeNationalAveragesFromMetrics([doc] as unknown as Parameters<
    typeof computeNationalAveragesFromMetrics
  >[0]);
  // The cutover: approval recomputed with the electorate weighting active.
  return computeStateApprovalBase(
    doc as unknown as Parameters<typeof computeStateApprovalBase>[0],
    averages,
    { groups: GROUPS }
  );
}

function runLoop(state: LoopState, turns: number, external: Record<NodeId, number>): LoopState {
  const value = { ...state.value };
  const baseline = { ...state.baseline };
  let approval = state.approval;
  const trace = [...state.trace];
  for (let t = 0; t < turns; t++) {
    const current: Record<NodeId, number> = { ...external };
    for (const n of CLUSTER) {
      const ctx: EngineNodeContext = {
        current,
        prev: { ...value, ...external },
        prevSimBaseline: baseline,
        providers: { governmentApproval: approval },
        spending: {},
        policyValue: value[n.id],
      };
      const r = evalNode(n, ctx, "sim");
      value[n.id] = r.value;
      baseline[n.id] = r.simBaseline;
      current[n.id] = r.value;
    }
    approval = approvalFromMetrics(value, external);
    trace.push(approval);
  }
  return { value, baseline, approval, trace };
}

const external: Record<NodeId, number> = {
  "economic.unemploymentRate": 5,
  "economic.gdpGrowth": 2.5,
  "governance.governmentTransparency": 55,
  "mediaInformation.pressFreedom": 69,
};

const seed = {
  "social.incomeInequality": 42,
  "mediaInformation.socialMediaSentiment": 0,
  "mediaInformation.mediaPolarization": 45,
  "mediaInformation.newsTrust": 50,
  "mediaInformation.disinformationRisk": 42,
  "governance.corruptionIndex": 40,
  "governance.publicTrust": 50,
};

function maxSwing(trace: number[], lastN: number): number {
  const tail = trace.slice(-lastN);
  return Math.max(...tail) - Math.min(...tail);
}

describe("P6d GATE 4 — approval loop damped under 2D weighting", () => {
  it("settles at constant inputs (final-year swing < 1pt, values bounded)", () => {
    const atFour = runLoop(fresh(seed, 50), 4 * TPY, external);
    const atEight = runLoop(atFour, 4 * TPY, external);
    for (const n of CLUSTER) {
      const v = atEight.value[n.id];
      expect(Number.isFinite(v), `${n.id} finite`).toBe(true);
      expect(v).toBeGreaterThanOrEqual(n.bounds[0]);
      expect(v).toBeLessThanOrEqual(n.bounds[1]);
    }
    expect(maxSwing(atEight.trace, TPY)).toBeLessThan(1);
  });

  it("absorbs shocks from both directions — convergent, gain < 1, no runaway", () => {
    const fromLow = runLoop(fresh(seed, 20), 8 * TPY, external);
    const fromHigh = runLoop(fresh(seed, 75), 8 * TPY, external);
    expect(maxSwing(fromLow.trace, TPY)).toBeLessThan(1);
    expect(maxSwing(fromHigh.trace, TPY)).toBeLessThan(1);
    expect(fromLow.approval).toBeGreaterThan(10);
    expect(fromHigh.approval).toBeLessThan(90);
    const gapEnd = Math.abs(fromHigh.approval - fromLow.approval);
    expect(gapEnd).toBeLessThan((75 - 20) * 0.6);
  });
});
