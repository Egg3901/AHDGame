import { describe, expect, it } from "vitest";
import { evalNode } from "../coexistence";
import type { EngineNodeContext, NodeId } from "../types";
import { ENVIRONMENT_NODES } from "./environment";
import { HEALTHCARE_NODES } from "./healthcare";
import { topoSort } from "../topoSort";

const TPY = 48;

/**
 * P3c chain dynamics — the carbon→air→lifeExpectancy chain goes live here
 * (lifeExpectancy reads {lagged: environment.airQuality}, sign fixed in Task 1).
 * The co-sim runs environment + healthcare: convergence, environment-investment
 * response flowing through the lag, the renewables root, and the sector mix.
 */
const CLUSTER = topoSort([...ENVIRONMENT_NODES, ...HEALTHCARE_NODES]);

type Rows = Array<{ revenue: number; sectorType?: string }>;

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
  external: Record<NodeId, number>,
  rows: Rows = []
): TierState {
  const value = { ...state.value };
  const baseline = { ...state.baseline };
  const providers = {
    sectorRevenueTax: {
      owned: rows,
      unowned: [],
      federalSalesTax: 0,
      stateSalesTax: 0,
      countryId: "US",
    },
  };
  for (let t = 0; t < turns; t++) {
    const current: Record<NodeId, number> = { ...external };
    for (const n of CLUSTER) {
      const ctx: EngineNodeContext = {
        current,
        prev: { ...value, ...external },
        prevSimBaseline: baseline,
        providers,
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
  "environment.renewableEnergy": 25,
  "environment.climateResilience": 60,
  "population.urbanizationRate": 58,
  "population.dependencyRatio": 0.55,
  "economic.povertyRate": 13,
  "economic.costOfLiving": 104,
  "healthcare.uninsuredRate": 10,
  "healthcare.publicHealthPreparedness": 50,
};

const seed = {
  "environment.carbonEmissions": 12.5,
  "environment.airQuality": 45,
  "environment.energyTransitionProgress": 35,
  "environment.floodRisk": 10.8,
  "environment.agriEmissionsShare": 38,
  "healthcare.physicianRate": 2.5,
  "healthcare.affordabilityIndex": 55,
  "healthcare.preventableMortality": 310,
  "healthcare.lifeExpectancy": 78,
};

// Realistic per-capita environment spend (spend-response recalibration, ticket
// #826 item 14 follow-up): 108 is the ~$108/capita federal-only baseline (2019
// default enacted us_clean_energy + us_conservation positions), and the
// "invested" test below uses ~700, near the ~$743/capita ceiling (all three US
// environment bills maxed) — see ENV_SPEND_HALF_SAT's doc comment in
// ./environment.ts for the sourcing. healthcare/social left as-is (out of
// scope for this category's calibration).
const BASE_SPEND = { environment: 108, healthcare: 2, social: 2 };
const MIXED_ROWS: Rows = [
  { revenue: 600, sectorType: "manufacturing" },
  { revenue: 400, sectorType: "technology" },
  { revenue: 300, sectorType: "financial" },
];

describe("P3c environment chain dynamics", () => {
  it("converges with the healthcare tier attached (no divergence/oscillation)", () => {
    const atFour = runTier(freshTier(seed), 4 * TPY, BASE_SPEND, external, MIXED_ROWS);
    const atEight = runTier(atFour, 4 * TPY, BASE_SPEND, external, MIXED_ROWS);
    for (const n of CLUSTER) {
      const v4 = atFour.value[n.id];
      expect(Number.isFinite(v4), `${n.id} finite`).toBe(true);
      expect(v4).toBeGreaterThanOrEqual(n.bounds[0]);
      expect(v4).toBeLessThanOrEqual(n.bounds[1]);
      const tol = n.bounds[1] > 500 ? 5 : 0.6;
      expect(Math.abs(atEight.value[n.id] - v4), `${n.id} steady (${v4})`).toBeLessThan(tol);
    }
  });

  it("environment investment cuts carbon, cleans the air, and (via the lag) lengthens lives", () => {
    const warm = runTier(freshTier(seed), 4 * TPY, BASE_SPEND, external, MIXED_ROWS);
    const held = runTier(warm, 6 * TPY, BASE_SPEND, external, MIXED_ROWS);
    const invested = runTier(
      warm,
      6 * TPY,
      { ...BASE_SPEND, environment: 700 },
      external,
      MIXED_ROWS
    );

    expect(invested.value["environment.carbonEmissions"]).toBeLessThan(
      held.value["environment.carbonEmissions"]
    );
    expect(invested.value["environment.airQuality"]).toBeLessThan(
      held.value["environment.airQuality"]
    );
    // Post-recalibration (half-sat 200, see ENV_SPEND_HALF_SAT), the full
    // $108→$700/capita swing moves envResp() ~35%→~78% (vs ~99%→~99.9% pre-
    // recalibration), i.e. a ~0.85 t carbon swing — real slope across the
    // achievable range, still sub-grain enough that the air→life lagged edge
    // stays a >= assertion rather than strict (the strict chain assertion
    // lives in the renewables test below, a 10+ AQI swing).
    expect(invested.value["healthcare.lifeExpectancy"]).toBeGreaterThanOrEqual(
      held.value["healthcare.lifeExpectancy"]
    );
  });

  it("raising the renewables root improves carbon, air, transition, AND life through the chain", () => {
    const warm = runTier(freshTier(seed), 4 * TPY, BASE_SPEND, external, MIXED_ROWS);
    const held = runTier(warm, 6 * TPY, BASE_SPEND, external, MIXED_ROWS);
    const green = runTier(
      warm,
      6 * TPY,
      BASE_SPEND,
      { ...external, "environment.renewableEnergy": 60 },
      MIXED_ROWS
    );

    expect(green.value["environment.carbonEmissions"]).toBeLessThan(
      held.value["environment.carbonEmissions"]
    );
    expect(green.value["environment.airQuality"]).toBeLessThan(
      held.value["environment.airQuality"]
    );
    expect(green.value["environment.energyTransitionProgress"]).toBeGreaterThan(
      held.value["environment.energyTransitionProgress"]
    );
    expect(green.value["healthcare.lifeExpectancy"]).toBeGreaterThan(
      held.value["healthcare.lifeExpectancy"]
    );
  });

  it("industrializing the sector mix dirties carbon/air; tertiarizing cleans them (mix CHANGE)", () => {
    // NOTE the coexistence contract: a STATIC mix is a level property absorbed
    // by the seed (parity theorem) — the responsive contract is to a mix CHANGE
    // from a warmed common state.
    const warm = runTier(freshTier(seed), 4 * TPY, BASE_SPEND, external, MIXED_ROWS);
    const held = runTier(warm, 6 * TPY, BASE_SPEND, external, MIXED_ROWS);
    const industrialized = runTier(warm, 6 * TPY, BASE_SPEND, external, [
      { revenue: 1000, sectorType: "energy" },
      { revenue: 500, sectorType: "manufacturing" },
    ]);
    const tertiarized = runTier(warm, 6 * TPY, BASE_SPEND, external, [
      { revenue: 1000, sectorType: "financial" },
      { revenue: 500, sectorType: "technology" },
    ]);
    expect(industrialized.value["environment.carbonEmissions"]).toBeGreaterThan(
      held.value["environment.carbonEmissions"]
    );
    expect(tertiarized.value["environment.carbonEmissions"]).toBeLessThan(
      held.value["environment.carbonEmissions"]
    );
    expect(industrialized.value["environment.airQuality"]).toBeGreaterThan(
      tertiarized.value["environment.airQuality"]
    );
  });
});
