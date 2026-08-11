import { describe, expect, it } from "vitest";
import { evalNode } from "../coexistence";
import type { EngineNodeContext, NodeId } from "../types";
import { healthcareMortalityModifier } from "@/lib/demographics/flows/mortality";
import { HEALTHCARE_NODES } from "./healthcare";

const TPY = 48;

/**
 * Healthcare-tier multi-turn stability + the healthcare→demographics mortality
 * loop (design §4.2 note): lifeExpectancy/preventableMortality feed
 * healthcareMortalityModifier each turn. The loop must be DAMPED — node inertia
 * + the modifier's [0.7,1.4] clamp ⇒ a converged tier yields a stable modifier.
 *
 * Spend levels use REAL per-capita magnitudes (HEALTH_SPEND_HALF_SAT=4000
 * recalibration, ticket #826 item 14 follow-up): the achievable US per-capita
 * range is $0-$9,484 (src/lib/seeds/reference/legislationTypes.ts healthcare
 * bills summed), with a ~$5,798/capita realistic policy baseline — not the
 * old toy scale (2-15) that pegged the response near max regardless of spend.
 */
interface TierState {
  value: Record<NodeId, number>;
  baseline: Record<NodeId, number>;
}

function freshTier(): TierState {
  const value: Record<NodeId, number> = {};
  for (const n of HEALTHCARE_NODES) value[n.id] = (n.bounds[0] + n.bounds[1]) / 2;
  // lifeExpectancy bounds span every era ([35,90]); arithmetic mid (62.5) sits
  // far below the mortality-modifier neutral (77.5) and saturates the [0.7,1.4]
  // clamp for both funded and starved runs. Seed at the modern mid so this
  // US-dynamics sim still probes the unsaturated slope.
  value["healthcare.lifeExpectancy"] = 77.5;
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
    for (const n of HEALTHCARE_NODES) {
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

describe("healthcare tier multi-turn stability + mortality loop", () => {
  const external: Record<NodeId, number> = {
    "healthcare.uninsuredRate": 9,
    "healthcare.publicHealthPreparedness": 60,
    "healthcare.slaintecareProgress": 30,
    "population.dependencyRatio": 0.62,
    "economic.costOfLiving": 105,
    "economic.povertyRate": 12,
    "environment.airQuality": 60,
  };

  it("converges to a steady state within bounds", () => {
    const atFour = runTier(freshTier(), 4 * TPY, { healthcare: 5798 }, external);
    const atEight = runTier(atFour, 4 * TPY, { healthcare: 5798 }, external);
    for (const n of HEALTHCARE_NODES) {
      const v4 = atFour.value[n.id];
      const v8 = atEight.value[n.id];
      expect(Number.isFinite(v4), `${n.id} finite`).toBe(true);
      expect(v4, `${n.id} >= lower`).toBeGreaterThanOrEqual(n.bounds[0]);
      expect(v4, `${n.id} <= upper`).toBeLessThanOrEqual(n.bounds[1]);
      expect(Math.abs(v8 - v4), `${n.id} steady (${v4} → ${v8})`).toBeLessThan(0.5);
    }
  });

  it("raising healthcare spending lifts outcomes; cutting lowers them", () => {
    // Realistic US per-capita magnitudes (achievable range $0-$9,484):
    // held = ~policy-default baseline ($5,798/capita); funded = near-max
    // ($9,484); starved = a low-but-nonzero posture ($200/capita).
    const warm = runTier(freshTier(), 4 * TPY, { healthcare: 5798 }, external);
    const held = runTier(warm, 4 * TPY, { healthcare: 5798 }, external);
    const funded = runTier(warm, 4 * TPY, { healthcare: 9484 }, external);
    const starved = runTier(warm, 4 * TPY, { healthcare: 200 }, external);
    // Higher-better outcomes rise with funding…
    for (const id of [
      "healthcare.physicianRate",
      "healthcare.lifeExpectancy",
      "healthcare.mentalHealthAccess",
      "healthcare.elderCareQuality",
    ]) {
      expect(funded.value[id], `${id} funded > held`).toBeGreaterThan(held.value[id]);
      expect(starved.value[id], `${id} starved < held`).toBeLessThan(held.value[id]);
    }
    // …and the lower-better waiting/mortality metrics fall with funding.
    for (const id of ["healthcare.preventableMortality", "healthcare.nhsWaitingTime"]) {
      expect(funded.value[id], `${id} funded < held`).toBeLessThan(held.value[id]);
      expect(starved.value[id], `${id} starved > held`).toBeGreaterThan(held.value[id]);
    }
  });

  it("the mortality loop is damped: a converged tier yields a stable, bounded modifier", () => {
    const steady = runTier(freshTier(), 8 * TPY, { healthcare: 5798 }, external);
    const m1 = healthcareMortalityModifier({
      lifeExpectancy: steady.value["healthcare.lifeExpectancy"],
      preventableMortality: steady.value["healthcare.preventableMortality"],
    });
    const later = runTier(steady, 2 * TPY, { healthcare: 5798 }, external);
    const m2 = healthcareMortalityModifier({
      lifeExpectancy: later.value["healthcare.lifeExpectancy"],
      preventableMortality: later.value["healthcare.preventableMortality"],
    });
    expect(m1).toBeGreaterThanOrEqual(0.7);
    expect(m1).toBeLessThanOrEqual(1.4);
    expect(Math.abs(m2 - m1), `modifier stable (${m1} → ${m2})`).toBeLessThan(0.02);
  });

  it("better-funded healthcare yields a LOWER mortality modifier (the loop's payoff)", () => {
    const warm = runTier(freshTier(), 4 * TPY, { healthcare: 5798 }, external);
    const funded = runTier(warm, 6 * TPY, { healthcare: 9484 }, external);
    const starved = runTier(warm, 6 * TPY, { healthcare: 200 }, external);
    const mFunded = healthcareMortalityModifier({
      lifeExpectancy: funded.value["healthcare.lifeExpectancy"],
      preventableMortality: funded.value["healthcare.preventableMortality"],
    });
    const mStarved = healthcareMortalityModifier({
      lifeExpectancy: starved.value["healthcare.lifeExpectancy"],
      preventableMortality: starved.value["healthcare.preventableMortality"],
    });
    expect(mFunded).toBeLessThan(mStarved);
  });
});
