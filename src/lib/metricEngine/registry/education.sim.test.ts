import { describe, expect, it } from "vitest";
import { evalNode } from "../coexistence";
import type { EngineNodeContext, NodeId } from "../types";
import { EDUCATION_NODES } from "./education";

const TPY = 48;

/**
 * Education-tier multi-turn stability (spec P2a Task 6 / design §8). At FIXED
 * inputs (constant spend, constant lagged poverty, constant seeded externals)
 * the whole tier must converge to a steady state inside bounds over ~4 game
 * years — the inertia EMA + bounded compute() must not diverge or oscillate.
 */
interface TierState {
  value: Record<NodeId, number>;
  baseline: Record<NodeId, number>;
}

function freshTier(): TierState {
  // Start every node mid-bounds; carry value + simBaseline per node across turns.
  const value: Record<NodeId, number> = {};
  for (const n of EDUCATION_NODES) value[n.id] = (n.bounds[0] + n.bounds[1]) / 2;
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
    for (const n of EDUCATION_NODES) {
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

describe("education tier multi-turn stability", () => {
  const external: Record<NodeId, number> = {
    "social.childPoverty": 18,
    "social.socialCohesion": 55,
    "economic.medianIncome": 52_000,
    "education.academicPressure": 50,
    "education.apprenticeshipRate": 3,
  };

  it("converges to a steady state within bounds (no divergence/oscillation)", () => {
    // 806 = today's realistic US federal education per-capita baseline (see
    // EDU_SPEND_HALF_SAT comment in ./education).
    const atFourYears = runTier(freshTier(), 4 * TPY, { education: 806 }, external);
    const atEightYears = runTier(atFourYears, 4 * TPY, { education: 806 }, external);
    for (const n of EDUCATION_NODES) {
      const v4 = atFourYears.value[n.id];
      const v8 = atEightYears.value[n.id];
      expect(Number.isFinite(v4), `${n.id} finite`).toBe(true);
      expect(v4, `${n.id} >= lower bound`).toBeGreaterThanOrEqual(n.bounds[0]);
      expect(v4, `${n.id} <= upper bound`).toBeLessThanOrEqual(n.bounds[1]);
      // Steady state: 4 more years move the value < 0.5.
      expect(Math.abs(v8 - v4), `${n.id} steady (${v4} → ${v8})`).toBeLessThan(0.5);
    }
  });

  it("RAISING spending after going live lifts outcomes; cutting lowers them (the coexistence contract)", () => {
    // The seed governs the LEVEL (cold-start delta anchors it); the engine
    // governs the RESPONSE to changes. So the testable dynamic is a spend
    // CHANGE from a common warmed-up state, not two cold starts.
    //
    // Realistic per-capita magnitudes (see EDU_SPEND_HALF_SAT comment in
    // ./education): held = today's $806 baseline; funded = the $6515
    // five-bill stacked max; starved = defunded toward $0.
    const warm = runTier(freshTier(), 4 * TPY, { education: 806 }, external);
    const held = runTier(warm, 4 * TPY, { education: 806 }, external);
    const funded = runTier(warm, 4 * TPY, { education: 6515 }, external);
    const starved = runTier(warm, 4 * TPY, { education: 20 }, external);
    for (const id of [
      "education.highSchoolGradRate",
      "education.testPerformance",
      "education.literacyRate",
      "education.gcseAttainment",
    ]) {
      expect(funded.value[id], `${id} funded > held`).toBeGreaterThan(held.value[id]);
      expect(starved.value[id], `${id} starved < held`).toBeLessThan(held.value[id]);
      // Meaningful separation now that the response actually has slope across
      // the realistic range (previously halfSat=1 pegged funded/held/starved
      // all within a fraction of a point of each other).
      expect(
        funded.value[id] - starved.value[id],
        `${id} funded-vs-starved spread`
      ).toBeGreaterThan(2);
    }
  });
});
