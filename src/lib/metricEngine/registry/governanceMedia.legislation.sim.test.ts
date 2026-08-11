import { describe, expect, it } from "vitest";
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
 * Legislative metric simulation — GOVERNANCE + MEDIA categories, 240 turns.
 *
 * Unlike the spending tiers, governance/media laws act through the POLICY layer:
 * they tag their target metrics via `effectTargetsWeighted`, and the metric decays
 * toward `baseline + contribution`. So these sims drive the laws' declared targets as
 * policy-controlled metrics (the harness root path) and assert each moves in the
 * law's direction over 240 turns, then converges within bounds.
 *
 *   • Governance — "Government Ethics & Transparency Act" (us_government_ethics, +1):
 *     governmentTransparency ↑, publicTrust ↑, newsTrust ↑.
 *   • Media — "Media & Communications Act" (us_media_communications, +1): pressFreedom ↑.
 */
const TURNS = 240;

const root = (id: NodeId, metricId: string, categoryId: string, initial: number): RootMetric => ({
  id,
  categoryId: categoryId as RootMetric["categoryId"],
  metricId,
  initial,
});

const baselineDoc: StateMetricBaseline = {
  _id: "federal",
  baselines: {
    governance: { governmentTransparency: 55, publicTrust: 50 },
    mediaInformation: { newsTrust: 50, pressFreedom: 69 },
  },
} as unknown as StateMetricBaseline;

function runLawOnRoots(lawId: string, roots: RootMetric[]) {
  const law = legislationTypes.find((l) => l._id === lawId);
  const reform = law?.policyOptions?.find((o) => o.effectDirection === 1);
  const { policy, legTypeMap } = enactedLaw(law!, {
    effectDirection: 1,
    policyOptionId: reform?.id,
  });
  const common = { nodes: [], roots, baselineDoc, providers: {}, legTypeMap, turns: TURNS };
  const warm = warmup({ ...common, policies: [] });
  const control = runLegislationSim({ ...common, policies: [] }, warm);
  const enacted = runLegislationSim({ ...common, policies: [policy] }, warm);
  return { law, reform, control, enacted };
}

describe("legislation sim — governance (Government Ethics & Transparency Act, 240 turns)", () => {
  const roots = [
    root("governance.governmentTransparency", "governmentTransparency", "governance", 55),
    root("governance.publicTrust", "publicTrust", "governance", 50),
    root("mediaInformation.newsTrust", "newsTrust", "mediaInformation", 50),
  ];
  const { law, reform, control, enacted } = runLawOnRoots("us_government_ethics", roots);
  const ids = roots.map((r) => r.id);

  it("the seed law and its reform option exist", () => {
    expect(law, "us_government_ethics present").toBeTruthy();
    expect(reform, "a pro-ethics (+1) option exists").toBeTruthy();
  });

  it("prints the 240-turn trajectory report", () => {
    console.log(
      reportTrajectory("Governance — Government Ethics & Transparency Act", ids, control, enacted)
    );
    expect(true).toBe(true);
  });

  it("transparency, public trust, and news trust all rise above the no-law control", () => {
    for (const id of ids) {
      expect(
        enacted.final[id],
        `${id}: law ${enacted.final[id]} > control ${control.final[id]}`
      ).toBeGreaterThan(control.final[id]);
    }
  });

  it("targets stay within [0,100] and converge (final-step motion → 0)", () => {
    for (const id of ids) {
      const v = enacted.final[id];
      expect(v, `${id} >= 0`).toBeGreaterThanOrEqual(0);
      expect(v, `${id} <= 100`).toBeLessThanOrEqual(100);
      const tr = enacted.trajectory[id];
      const lastStep = Math.abs(tr[tr.length - 1] - tr[tr.length - 2]);
      expect(lastStep, `${id} converged (final step ${lastStep})`).toBeLessThan(0.2);
    }
  });
});

describe("legislation sim — media (Media & Communications Act, 240 turns)", () => {
  const roots = [root("mediaInformation.pressFreedom", "pressFreedom", "mediaInformation", 69)];
  const { law, reform, control, enacted } = runLawOnRoots("us_media_communications", roots);

  it("the seed law and its reform option exist", () => {
    expect(law, "us_media_communications present").toBeTruthy();
    expect(reform, "a pro-press-freedom (+1) option exists").toBeTruthy();
  });

  it("prints the 240-turn trajectory report", () => {
    console.log(
      reportTrajectory(
        "Media — Media & Communications Act",
        ["mediaInformation.pressFreedom"],
        control,
        enacted
      )
    );
    expect(true).toBe(true);
  });

  it("press freedom rises above the no-law control and converges in bounds", () => {
    const id = "mediaInformation.pressFreedom";
    expect(
      enacted.final[id],
      `law ${enacted.final[id]} > control ${control.final[id]}`
    ).toBeGreaterThan(control.final[id]);
    expect(enacted.final[id]).toBeLessThanOrEqual(100);
    const tr = enacted.trajectory[id];
    expect(Math.abs(tr[tr.length - 1] - tr[tr.length - 2]), "converged (final step)").toBeLessThan(
      0.2
    );
  });
});
