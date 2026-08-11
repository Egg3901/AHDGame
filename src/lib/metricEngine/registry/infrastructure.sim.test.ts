import { describe, expect, it } from "vitest";
import { evalNode } from "../coexistence";
import type { EngineNodeContext, NodeId } from "../types";
import { INFRASTRUCTURE_NODES } from "./infrastructure";

const TPY = 48;

/**
 * Infrastructure maintenance-decay dynamics (P2c): sustained underfunding ERODES
 * the capital stocks turn over turn; restoring funding re-pins them; the tier
 * converges (no divergence) at constant funding.
 */
interface TierState {
  value: Record<NodeId, number>;
  baseline: Record<NodeId, number>;
}

function freshTier(seed: Record<string, number>): TierState {
  const value: Record<NodeId, number> = {};
  for (const n of INFRASTRUCTURE_NODES) value[n.id] = seed[n.id] ?? (n.bounds[0] + n.bounds[1]) / 2;
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
    for (const n of INFRASTRUCTURE_NODES) {
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

const external: Record<NodeId, number> = { "environment.renewableEnergy": 30 };
const seeded = {
  "infrastructure.roadCondition": 70,
  "infrastructure.publicTransit": 50,
  "infrastructure.broadbandAccess": 80,
  "infrastructure.waterQuality": 90,
  "infrastructure.powerGridReliability": 98.5,
};

describe("infrastructure maintenance-decay dynamics", () => {
  it("converges at constant adequate funding (no divergence)", () => {
    // $1,500/capita — realistic funding above the empirically-confirmed real
    // baseline (~$1,238/capita, see INFRA_SPEND_HALF_SAT), not a toy value.
    const atFour = runTier(freshTier(seeded), 4 * TPY, { infrastructure: 1500 }, external);
    const atEight = runTier(atFour, 4 * TPY, { infrastructure: 1500 }, external);
    for (const n of INFRASTRUCTURE_NODES) {
      const v4 = atFour.value[n.id];
      expect(Number.isFinite(v4), `${n.id} finite`).toBe(true);
      expect(v4).toBeGreaterThanOrEqual(n.bounds[0]);
      expect(v4).toBeLessThanOrEqual(n.bounds[1]);
      expect(Math.abs(atEight.value[n.id] - v4), `${n.id} steady`).toBeLessThan(0.5);
    }
  });

  it("sustained UNDERFUNDING erodes the capital stocks year over year", () => {
    const start = freshTier(seeded);
    // $5/capita — effectively no real-world infrastructure funding.
    const afterTwoYears = runTier(start, 2 * TPY, { infrastructure: 5 }, external);
    const afterFourYears = runTier(afterTwoYears, 2 * TPY, { infrastructure: 5 }, external);
    for (const id of [
      "infrastructure.roadCondition",
      "infrastructure.publicTransit",
      "infrastructure.broadbandAccess",
      "infrastructure.waterQuality",
    ]) {
      expect(afterTwoYears.value[id], `${id} eroding by year 2`).toBeLessThan(start.value[id]);
      expect(afterFourYears.value[id], `${id} still eroding by year 4`).toBeLessThan(
        afterTwoYears.value[id]
      );
    }
  });

  it("restored funding RE-PINS an eroded stock (recovery)", () => {
    // Eroded at $5/capita (effectively no funding), then restored at
    // $4,000/capita — near the realistic ~$5,066/capita achievable ceiling.
    const eroded = runTier(freshTier(seeded), 4 * TPY, { infrastructure: 5 }, external);
    const restored = runTier(eroded, 4 * TPY, { infrastructure: 4000 }, external);
    for (const id of ["infrastructure.roadCondition", "infrastructure.publicTransit"]) {
      expect(restored.value[id], `${id} recovers with funding`).toBeGreaterThan(eroded.value[id]);
    }
  });

  it("the investment gap shrinks when funding rises (lower-better readout)", () => {
    // $200/capita (thin funding) vs $3,500/capita (near the realistic ceiling)
    // — a real-scale contrast, not a toy nudge.
    const warm = runTier(freshTier(seeded), 2 * TPY, { infrastructure: 200 }, external);
    const funded = runTier(warm, 2 * TPY, { infrastructure: 3500 }, external);
    expect(funded.value["infrastructure.infrastructureInvestmentGap"]).toBeLessThan(
      warm.value["infrastructure.infrastructureInvestmentGap"]
    );
  });
});
