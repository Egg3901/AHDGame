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

const TPY = 48;

/**
 * P4 — THE APPROVAL FEEDBACK LOOP, closed with the REAL approval function:
 * each sim turn evaluates the tier off last turn's approval (the provider lag),
 * assembles a metrics doc from the node values, and recomputes approval via
 * computeStateApprovalBase for the next turn. The loop must be damped: settle
 * at constant inputs, absorb approval shocks from both directions without
 * oscillation or runaway, and propagate an economy shock without divergence.
 */
const CLUSTER = topoSort([...MEDIA_INFORMATION_NODES, ...GOVERNANCE_NODES, incomeInequalityNode]);

interface LoopState {
  value: Record<NodeId, number>;
  baseline: Record<NodeId, number>;
  approval: number;
  approvalTrace: number[];
}

function fresh(seed: Record<string, number>, approval: number): LoopState {
  const value: Record<NodeId, number> = {};
  for (const n of CLUSTER) value[n.id] = seed[n.id] ?? (n.bounds[0] + n.bounds[1]) / 2;
  return { value, baseline: {}, approval, approvalTrace: [approval] };
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
  return computeStateApprovalBase(
    doc as unknown as Parameters<typeof computeStateApprovalBase>[0],
    averages
  );
}

function runLoop(state: LoopState, turns: number, external: Record<NodeId, number>): LoopState {
  const value = { ...state.value };
  const baseline = { ...state.baseline };
  let approval = state.approval;
  const approvalTrace = [...state.approvalTrace];
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
    approvalTrace.push(approval);
  }
  return { value, baseline, approval, approvalTrace };
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

describe("P4 approval feedback loop dynamics", () => {
  it("settles at constant inputs (no oscillation, bounded values)", () => {
    const atFour = runLoop(fresh(seed, 50), 4 * TPY, external);
    const atEight = runLoop(atFour, 4 * TPY, external);
    for (const n of CLUSTER) {
      const v = atEight.value[n.id];
      expect(Number.isFinite(v), `${n.id} finite`).toBe(true);
      expect(v).toBeGreaterThanOrEqual(n.bounds[0]);
      expect(v).toBeLessThanOrEqual(n.bounds[1]);
    }
    // The approval trace's final year swings less than one point.
    expect(maxSwing(atEight.approvalTrace, TPY)).toBeLessThan(1);
  });

  it("absorbs approval shocks from BOTH directions — damped, convergent, no runaway", () => {
    const fromLow = runLoop(fresh(seed, 20), 8 * TPY, external);
    const fromHigh = runLoop(fresh(seed, 75), 8 * TPY, external);
    // Both settle (final-year swing < 1pt) ...
    expect(maxSwing(fromLow.approvalTrace, TPY)).toBeLessThan(1);
    expect(maxSwing(fromHigh.approvalTrace, TPY)).toBeLessThan(1);
    // ... to interior equilibria (no pegging at the bounds) ...
    expect(fromLow.approval).toBeGreaterThan(10);
    expect(fromHigh.approval).toBeLessThan(90);
    // ... and the loop gain < 1 pulls the two starts toward each other.
    const gap0 = 75 - 20;
    const gapEnd = Math.abs(fromHigh.approval - fromLow.approval);
    expect(gapEnd).toBeLessThan(gap0 * 0.6);
  });

  it("an unemployment shock propagates (sentiment/trust down) without divergence", () => {
    const warm = runLoop(fresh(seed, 50), 4 * TPY, external);
    const held = runLoop(warm, 4 * TPY, external);
    const shocked = runLoop(warm, 4 * TPY, {
      ...external,
      "economic.unemploymentRate": 9,
    });
    expect(shocked.value["mediaInformation.socialMediaSentiment"]).toBeLessThan(
      held.value["mediaInformation.socialMediaSentiment"]
    );
    expect(shocked.value["governance.publicTrust"]).toBeLessThan(
      held.value["governance.publicTrust"]
    );
    expect(maxSwing(shocked.approvalTrace, TPY)).toBeLessThan(1.5);
  });
});
