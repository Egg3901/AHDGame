import { describe, expect, it } from "vitest";
import { ENVIRONMENT_NODES } from "./environment";
import { HEALTHCARE_NODES } from "./healthcare";
import { topoSort } from "../topoSort";
import { legislationTypes } from "@/lib/seeds/reference/legislationTypes";
import {
  runLegislationSim,
  warmup,
  enactedLaw,
  reportTrajectory,
} from "../__sims__/legislationSim";
import type { NodeId } from "../types";
import type { StateMetricBaseline } from "@/lib/db/types/statePolicy";

/**
 * Legislative metric simulation — ENVIRONMENT category, 240 turns.
 *
 * Law: "Climate and Net Zero Act" (uk_climate_net_zero), strongest decarbonisation
 * option (+1, ~$531/capita per its withPerCapitaCosts). Environment nodes read
 * `spending.environment` (and the sector-revenue provider for emissions
 * intensity); the healthcare tier runs alongside (air quality feeds health).
 * Enacting = raising environment spend from the ~$108/capita realistic US
 * federal baseline to ~$639/capita (108 + the bill's ~$531/capita), still under
 * the ~$743/capita ceiling — see ENV_SPEND_HALF_SAT's doc comment in
 * ./environment.ts for the full per-capita sourcing (spend-response
 * recalibration, ticket #826 item 14 follow-up). Expected: the energy
 * transition advances and carbon emissions fall.
 */
const TURNS = 240;
const TPY = 48;

const CLUSTER = topoSort([...ENVIRONMENT_NODES, ...HEALTHCARE_NODES]);

const law = legislationTypes.find((l) => l._id === "uk_climate_net_zero");
const invest = law?.policyOptions?.find((o) => o.effectDirection === 1);

const baselineDoc: StateMetricBaseline = {
  _id: "federal",
  baselines: {},
} as unknown as StateMetricBaseline;

// Sector-revenue provider (emissions-intensity input the environment nodes read).
const providers = {
  sectorRevenueTax: {
    owned: [
      { revenue: 600, sectorType: "manufacturing" },
      { revenue: 400, sectorType: "technology" },
      { revenue: 300, sectorType: "financial" },
    ],
    unowned: [],
    federalSalesTax: 0,
    stateSalesTax: 0,
    countryId: "US",
  },
};

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
const initial: Partial<Record<NodeId, number>> = {
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

const HIGHER_BETTER: NodeId[] = ["environment.energyTransitionProgress"];
const LOWER_BETTER: NodeId[] = ["environment.carbonEmissions"];

const baseSpend = { environment: 108, healthcare: 2, social: 2 };
const lawSpend = { environment: 639, healthcare: 2, social: 2 };

describe("legislation sim — environment (Climate and Net Zero Act, 240 turns)", () => {
  it("the seed law and its decarbonisation option exist", () => {
    expect(law, "uk_climate_net_zero present").toBeTruthy();
    expect(invest, "a strong-action (+1) option exists").toBeTruthy();
  });

  const { legTypeMap } = enactedLaw(law!, { effectDirection: 1, policyOptionId: invest?.id });
  const common = {
    nodes: CLUSTER,
    baselineDoc,
    external,
    initial,
    providers,
    legTypeMap,
    turns: TURNS,
  };
  const warm = warmup({ ...common, policies: [], spending: baseSpend });
  const control = runLegislationSim({ ...common, policies: [], spending: baseSpend }, warm);
  const enacted = runLegislationSim({ ...common, policies: [], spending: lawSpend }, warm);

  it("prints the 240-turn trajectory report", () => {
    console.log(
      reportTrajectory(
        "Environment — Climate and Net Zero Act",
        [...HIGHER_BETTER, ...LOWER_BETTER],
        control,
        enacted
      )
    );
    expect(true).toBe(true);
  });

  it("energy transition advances vs the no-law control", () => {
    for (const id of HIGHER_BETTER) {
      expect(
        enacted.final[id],
        `${id}: law ${enacted.final[id]} > control ${control.final[id]}`
      ).toBeGreaterThan(control.final[id]);
    }
  });

  it("carbon emissions fall below the no-law control", () => {
    for (const id of LOWER_BETTER) {
      expect(
        enacted.final[id],
        `${id}: law ${enacted.final[id]} < control ${control.final[id]}`
      ).toBeLessThan(control.final[id]);
    }
  });

  it("environment nodes stay within bounds and converge (stable tail)", () => {
    for (const n of ENVIRONMENT_NODES) {
      const v = enacted.final[n.id];
      expect(Number.isFinite(v), `${n.id} finite`).toBe(true);
      expect(v, `${n.id} >= lower`).toBeGreaterThanOrEqual(n.bounds[0]);
      expect(v, `${n.id} <= upper`).toBeLessThanOrEqual(n.bounds[1]);
      const tail = enacted.trajectory[n.id].slice(-TPY);
      expect(Math.max(...tail) - Math.min(...tail), `${n.id} converged`).toBeLessThan(
        Math.max(1.0, 0.02 * Math.abs(v))
      );
    }
  });
});
