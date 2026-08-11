import { describe, expect, it } from "vitest";
import type { EngineNodeContext } from "../types";
import {
  roadConditionNode,
  broadbandAccessNode,
  powerGridReliabilityNode,
  infrastructureInvestmentGapNode,
  transportEfficiencyNode,
  INFRASTRUCTURE_NODES,
} from "./infrastructure";

function ctx(partial: {
  spending?: Record<string, number>;
  current?: Record<string, number>;
  prev?: Record<string, number>;
}): EngineNodeContext {
  return {
    current: partial.current ?? {},
    prev: partial.prev ?? {},
    prevSimBaseline: {},
    providers: {},
    spending: partial.spending ?? {},
    policyValue: NaN,
  };
}

describe("infrastructure nodes — maintenance-decay", () => {
  it("an UNDERFUNDED road stock erodes its baseline by at most the effective decay", () => {
    // compute() decays the simBASELINE at decay/(1−inertia) = 0.06/0.15 = 0.4 per
    // turn; the EMA damps that to the intended 0.06/turn on the VALUE (the
    // sim test proves the value-level erosion rate).
    const base = 80;
    const out = roadConditionNode.compute!(
      ctx({
        // $5/capita — effectively no real-world infrastructure funding.
        spending: { infrastructure: 5 },
        prev: { "infrastructure.roadCondition": base },
      })
    );
    expect(out).toBeLessThan(base); // erosion
    expect(out).toBeGreaterThanOrEqual(base - 0.4 - 1e-9); // bounded by the effective decay
  });

  it("ADEQUATE funding holds the stock up (no erosion below the supported level)", () => {
    // $1,500/capita — above the empirically-confirmed real baseline (~$1,238/capita,
    // see INFRA_SPEND_HALF_SAT) — supports roadCondition above 60.
    const out = roadConditionNode.compute!(
      ctx({ spending: { infrastructure: 1500 }, prev: { "infrastructure.roadCondition": 60 } })
    );
    // High spend supports a level ABOVE prev → target wins, no decay applied.
    expect(out).toBeGreaterThanOrEqual(60);
  });

  it("broadband decays slower than roads (per-turn decay ordering)", () => {
    const roads = roadConditionNode.compute!(
      ctx({ spending: {}, prev: { "infrastructure.roadCondition": 80 } })
    );
    const broadband = broadbandAccessNode.compute!(
      ctx({ spending: {}, prev: { "infrastructure.broadbandAccess": 80 } })
    );
    expect(80 - broadband).toBeLessThan(80 - roads);
  });

  it("grid reliability gains a small modernization term from lagged renewables", () => {
    const low = powerGridReliabilityNode.compute!(
      ctx({
        spending: { infrastructure: 4 },
        prev: { "infrastructure.powerGridReliability": 97, "environment.renewableEnergy": 10 },
      })
    );
    const high = powerGridReliabilityNode.compute!(
      ctx({
        spending: { infrastructure: 4 },
        prev: { "infrastructure.powerGridReliability": 97, "environment.renewableEnergy": 80 },
      })
    );
    expect(high).toBeGreaterThan(low);
  });
});

describe("infrastructure nodes — gap + composite", () => {
  it("investment gap SHRINKS with spending (lower is better)", () => {
    // $100/capita (starved) vs $3,000/capita (funded, near the ~$5,066/capita
    // realistic ceiling) — a spread across the real achievable range, not a
    // toy-scale nudge, so the gap moves substantially rather than by a
    // fraction of a point.
    const starved = infrastructureInvestmentGapNode.compute!(
      ctx({ spending: { infrastructure: 100 } })
    );
    const funded = infrastructureInvestmentGapNode.compute!(
      ctx({ spending: { infrastructure: 3000 } })
    );
    expect(funded).toBeLessThan(starved);
    expect(
      starved - funded,
      "gap narrows meaningfully, not by a fraction of a point"
    ).toBeGreaterThan(20);
  });

  it("transportEfficiency rises with both transit and road condition", () => {
    const low = transportEfficiencyNode.compute!(
      ctx({
        current: { "infrastructure.publicTransit": 20, "infrastructure.roadCondition": 45 },
      })
    );
    const high = transportEfficiencyNode.compute!(
      ctx({
        current: { "infrastructure.publicTransit": 80, "infrastructure.roadCondition": 90 },
      })
    );
    expect(high).toBeGreaterThan(low);
  });
});

describe("infrastructure nodes — well-formed", () => {
  it("finite at neutral inputs; metadata sane; zero spend safe", () => {
    for (const node of INFRASTRUCTURE_NODES) {
      expect(Number.isFinite(node.compute!(ctx({}))), `${node.id} zero-spend`).toBe(true);
      expect(
        Number.isFinite(node.compute!(ctx({ spending: { infrastructure: 3 } }))),
        `${node.id} finite`
      ).toBe(true);
      expect(node.bounds[0]).toBeLessThan(node.bounds[1]);
      expect(node.kind).toBe("derived");
      expect(node.id.startsWith("infrastructure.")).toBe(true);
    }
  });
});
