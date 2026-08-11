import { describe, expect, it } from "vitest";
import { INFRASTRUCTURE_NODES } from "./infrastructure";
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
 * Legislative metric simulation — INFRASTRUCTURE category, 240 turns.
 *
 * Law: "Transportation Infrastructure Act" (us_transportation), high-investment
 * option (effectDirection +1). The infrastructure outcome nodes read
 * `spending.infrastructure` directly, so enacting the funding law is modelled as the
 * spend rising from the empirically-confirmed real US baseline (~$1,238/capita —
 * see INFRA_SPEND_HALF_SAT for how this is derived from the enacted-default federal
 * bills, GDP-cost-scaled) to the level implied by swapping just this bill's default
 * option ($636/capita nominal) for its most-expansive option ($1,273/capita nominal),
 * i.e. (1273 + 339) * 1.27 ≈ $2,047/capita. powerGridReliability starts near its
 * ceiling (98.5/100), so we assert direction on the metrics with real headroom.
 */
const TURNS = 240;
const TPY = 48;

const law = legislationTypes.find((l) => l._id === "us_transportation");
const invest = law?.policyOptions?.find((o) => o.effectDirection === 1);

const baselineDoc: StateMetricBaseline = {
  _id: "federal",
  baselines: {},
} as unknown as StateMetricBaseline;
const external: Record<NodeId, number> = { "environment.renewableEnergy": 30 };
const initial: Partial<Record<NodeId, number>> = {
  "infrastructure.roadCondition": 70,
  "infrastructure.publicTransit": 50,
  "infrastructure.broadbandAccess": 80,
  "infrastructure.waterQuality": 90,
  "infrastructure.powerGridReliability": 98.5,
};

// Spending-responsive metrics with clear headroom (powerGrid near ceiling → excluded).
const HIGHER_BETTER: NodeId[] = [
  "infrastructure.roadCondition",
  "infrastructure.publicTransit",
  "infrastructure.broadbandAccess",
];

describe("legislation sim — infrastructure (Transportation Infrastructure Act, 240 turns)", () => {
  it("the seed law and its high-investment option exist", () => {
    expect(law, "us_transportation present").toBeTruthy();
    expect(invest, "an investment (effectDirection +1) option exists").toBeTruthy();
  });

  const { legTypeMap } = enactedLaw(law!, { effectDirection: 1, policyOptionId: invest?.id });
  const common = {
    nodes: INFRASTRUCTURE_NODES,
    baselineDoc,
    external,
    initial,
    providers: {},
    legTypeMap,
    turns: TURNS,
  };
  const warm = warmup({ ...common, policies: [], spending: { infrastructure: 1238 } });
  const control = runLegislationSim(
    { ...common, policies: [], spending: { infrastructure: 1238 } },
    warm
  );
  const enacted = runLegislationSim(
    { ...common, policies: [], spending: { infrastructure: 2047 } },
    warm
  );

  it("prints the 240-turn trajectory report", () => {
    console.log(
      reportTrajectory(
        "Infrastructure — Transportation Infrastructure Act",
        HIGHER_BETTER,
        control,
        enacted
      )
    );
    expect(true).toBe(true);
  });

  it("higher-better infrastructure outcomes end ABOVE the no-law control", () => {
    for (const id of HIGHER_BETTER) {
      expect(
        enacted.final[id],
        `${id}: law ${enacted.final[id]} > control ${control.final[id]}`
      ).toBeGreaterThan(control.final[id]);
    }
  });

  it("every node stays within bounds and converges (stable tail)", () => {
    for (const n of INFRASTRUCTURE_NODES) {
      const v = enacted.final[n.id];
      expect(Number.isFinite(v), `${n.id} finite`).toBe(true);
      expect(v, `${n.id} >= lower`).toBeGreaterThanOrEqual(n.bounds[0]);
      expect(v, `${n.id} <= upper`).toBeLessThanOrEqual(n.bounds[1]);
      const tail = enacted.trajectory[n.id].slice(-TPY);
      expect(Math.max(...tail) - Math.min(...tail), `${n.id} converged`).toBeLessThan(1.0);
    }
  });
});
