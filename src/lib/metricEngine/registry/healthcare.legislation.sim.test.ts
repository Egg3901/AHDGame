import { describe, expect, it } from "vitest";
import { HEALTHCARE_NODES } from "./healthcare";
import { legislationTypes } from "@/lib/seeds/reference/legislationTypes";
import {
  runLegislationSim,
  warmup,
  enactedLaw,
  reportTrajectory,
  type RootMetric,
} from "../__sims__/legislationSim";
import type { NodeId } from "../types";
import type { StateMetricBaseline } from "@/lib/db/types/statePolicy";

/**
 * Legislative metric simulation — HEALTHCARE category, 240 turns.
 *
 * Law: "Federal Healthcare Access Act" (us_federal_healthcare_funding), single-payer
 * option (effectDirection +1). Per its §4.7 design it does NOT directly tag the
 * outcome nodes (avoids double-count); instead it (a) drives the `uninsuredRate`
 * ROOT down and (b) raises healthcare spending — both lift the engine outcome nodes.
 *
 * We run an identical CONTROL (no law, baseline spend) beside the LAW run and assert
 * the law moves each metric in its EXPECTED direction, stays in bounds, and converges.
 * The spend levels use REAL per-capita magnitudes (HEALTH_SPEND_HALF_SAT=4000
 * recalibration, ticket #826 item 14 follow-up): control = ~$5,798/capita (the
 * policy-default realistic baseline); enacted = $7,968/capita, i.e. baseline plus
 * this bill's own per-capita cost delta from its "moderate/center" option ($2,480,
 * src/lib/seeds/reference/legislationTypes.ts us_federal_healthcare_funding) to its
 * single-payer option ($4,650) — a +$2,170/capita swing, well within the $0-$9,484
 * achievable range.
 */
const TURNS = 240;
const TPY = 48;

const law = legislationTypes.find((l) => l._id === "us_federal_healthcare_funding");
const singlePayer = law?.policyOptions?.find((o) => o.effectDirection === 1);

const baselineDoc: StateMetricBaseline = {
  _id: "federal",
  baselines: { healthcare: { uninsuredRate: 9 } },
} as unknown as StateMetricBaseline;

const roots: RootMetric[] = [
  {
    id: "healthcare.uninsuredRate",
    categoryId: "healthcare",
    metricId: "uninsuredRate",
    initial: 9,
  },
];

// Constant cross-metric inputs the healthcare nodes read (held equal in both runs).
const external: Record<NodeId, number> = {
  "healthcare.publicHealthPreparedness": 60,
  "healthcare.slaintecareProgress": 30,
  "population.dependencyRatio": 0.62,
  "economic.costOfLiving": 105,
  "economic.povertyRate": 12,
  "environment.airQuality": 60,
};

const HIGHER_BETTER: NodeId[] = [
  "healthcare.physicianRate",
  "healthcare.lifeExpectancy",
  "healthcare.mentalHealthAccess",
  "healthcare.elderCareQuality",
  "healthcare.affordabilityIndex",
];
const LOWER_BETTER: NodeId[] = ["healthcare.preventableMortality"];

describe("legislation sim — healthcare (Federal Healthcare Access Act, 240 turns)", () => {
  it("the seed law and its single-payer option exist", () => {
    expect(law, "us_federal_healthcare_funding present in registry").toBeTruthy();
    expect(singlePayer, "a single-payer (effectDirection +1) option exists").toBeTruthy();
  });

  const { policy, legTypeMap } = enactedLaw(law!, {
    effectDirection: 1,
    policyOptionId: singlePayer?.id,
  });
  const common = {
    nodes: HEALTHCARE_NODES,
    roots,
    baselineDoc,
    external,
    providers: {},
    legTypeMap,
    turns: TURNS,
  };
  // Warm at pre-law conditions (baseline healthcare spend, no law); control + law both start here.
  const warm = warmup({ ...common, policies: [], spending: { healthcare: 5798 } });
  const control = runLegislationSim(
    { ...common, policies: [], spending: { healthcare: 5798 } },
    warm
  );
  const enacted = runLegislationSim(
    { ...common, policies: [policy], spending: { healthcare: 7968 } },
    warm
  );

  it("prints the 240-turn trajectory report", () => {
    console.log(
      reportTrajectory(
        "Healthcare — Federal Healthcare Access Act (single-payer)",
        ["healthcare.uninsuredRate", ...HIGHER_BETTER, ...LOWER_BETTER],
        control,
        enacted
      )
    );
    expect(true).toBe(true);
  });

  it("expands coverage: uninsuredRate falls below baseline and below the no-law control", () => {
    const lawUninsured = enacted.final["healthcare.uninsuredRate"];
    expect(lawUninsured, "law uninsuredRate < initial 9").toBeLessThan(9);
    expect(
      lawUninsured,
      `law uninsuredRate (${lawUninsured}) < control (${control.final["healthcare.uninsuredRate"]})`
    ).toBeLessThan(control.final["healthcare.uninsuredRate"]);
  });

  it("higher-better outcomes end ABOVE the no-law control", () => {
    for (const id of HIGHER_BETTER) {
      expect(
        enacted.final[id],
        `${id}: law ${enacted.final[id]} > control ${control.final[id]}`
      ).toBeGreaterThan(control.final[id]);
    }
  });

  it("lower-better outcomes end BELOW the no-law control", () => {
    for (const id of LOWER_BETTER) {
      expect(
        enacted.final[id],
        `${id}: law ${enacted.final[id]} < control ${control.final[id]}`
      ).toBeLessThan(control.final[id]);
    }
  });

  it("every node stays within its bounds and converges (stable tail)", () => {
    for (const n of HEALTHCARE_NODES) {
      const v = enacted.final[n.id];
      expect(Number.isFinite(v), `${n.id} finite`).toBe(true);
      expect(v, `${n.id} >= lower bound`).toBeGreaterThanOrEqual(n.bounds[0]);
      expect(v, `${n.id} <= upper bound`).toBeLessThanOrEqual(n.bounds[1]);
      // converged: the last game-year of motion is small
      const tail = enacted.trajectory[n.id].slice(-TPY);
      expect(Math.max(...tail) - Math.min(...tail), `${n.id} converged`).toBeLessThan(1.0);
    }
  });
});
