import { describe, expect, it } from "vitest";
import {
  pickSovereignDemandExperimentFlags,
  sovereignDemandRunWorldArgs,
} from "./sovereignDemandExperimentFlags";
import { SOVEREIGN_DEMAND_SCENARIOS } from "@/lib/bonds/sovereignDemandEvaluation";

describe("sovereign demand experiment flag carry (#1001)", () => {
  it("persists explicit booleans and preserves absent/default-off", () => {
    expect(
      pickSovereignDemandExperimentFlags({
        sovereignIssuanceConsolidationEnabled: true,
        domesticSovereignBondCoverageEnabled: false,
      })
    ).toEqual({
      sovereignIssuanceConsolidationEnabled: true,
      domesticSovereignBondCoverageEnabled: false,
    });
    // Absent stays absent: the scheduler default (off) applies downstream.
    expect(pickSovereignDemandExperimentFlags({})).toEqual({});
    expect(pickSovereignDemandExperimentFlags({ preset: "2019-default", turns: 500 })).toEqual({});
  });

  it("rejects invalid values instead of coercing them", () => {
    for (const bad of ["true", "false", "yes", 1, 0, null, {}, []]) {
      expect(() =>
        pickSovereignDemandExperimentFlags({ sovereignIssuanceConsolidationEnabled: bad })
      ).toThrow("must be boolean");
      expect(() =>
        pickSovereignDemandExperimentFlags({ domesticSovereignBondCoverageEnabled: bad })
      ).toThrow("must be boolean");
    }
  });

  it("maps persisted fields to the exact runWorld CLI args", () => {
    expect(
      sovereignDemandRunWorldArgs({
        sovereignIssuanceConsolidationEnabled: true,
        domesticSovereignBondCoverageEnabled: false,
      })
    ).toEqual([
      "--sovereign-issuance-consolidation=true",
      "--domestic-sovereign-bond-coverage=false",
    ]);
    // Explicit false still emits (pins the control arm); absent emits nothing.
    expect(sovereignDemandRunWorldArgs({ domesticSovereignBondCoverageEnabled: false })).toEqual([
      "--domestic-sovereign-bond-coverage=false",
    ]);
    expect(sovereignDemandRunWorldArgs({})).toEqual([]);
  });

  it("round-trips job creation to worker args to report identity", () => {
    // What the worldsim MCP persists on the simJobs doc...
    const persisted = pickSovereignDemandExperimentFlags({
      preset: "2019-default",
      turns: 500,
      seed: "s1",
      sovereignIssuanceConsolidationEnabled: false,
      domesticSovereignBondCoverageEnabled: true,
    });
    // ...becomes the worker's runWorld fragment...
    const args = sovereignDemandRunWorldArgs(persisted);
    expect(args).toEqual([
      "--sovereign-issuance-consolidation=false",
      "--domestic-sovereign-bond-coverage=true",
    ]);
    // ...and survives the collector's requestedConfig identity pick.
    const identity = pickSovereignDemandExperimentFlags({
      preset: "2019-default",
      ...persisted,
    });
    expect(identity).toEqual(persisted);
  });

  it("keeps all four #1001 scenarios queueable with both flags pinned", () => {
    expect(SOVEREIGN_DEMAND_SCENARIOS).toHaveLength(4);
    for (const scenario of SOVEREIGN_DEMAND_SCENARIOS) {
      expect(scenario.queueable).toBe(true);
      expect(scenario.runWorldArgs).not.toBeNull();
      const args = scenario.runWorldArgs ?? [];
      const byFlag = new Map(
        args.map((arg) => {
          const separator = arg.indexOf("=");
          return [arg.slice(0, separator), arg.slice(separator + 1)];
        })
      );
      // Each scenario pins both gates explicitly so the comparison is
      // controlled, and each fragment parses back through the shared mapping.
      expect(byFlag.get("--sovereign-issuance-consolidation")).toMatch(/^(true|false)$/);
      expect(byFlag.get("--domestic-sovereign-bond-coverage")).toMatch(/^(true|false)$/);
      const parsed = pickSovereignDemandExperimentFlags({
        sovereignIssuanceConsolidationEnabled:
          byFlag.get("--sovereign-issuance-consolidation") === "true",
        domesticSovereignBondCoverageEnabled:
          byFlag.get("--domestic-sovereign-bond-coverage") === "true",
      });
      expect(sovereignDemandRunWorldArgs(parsed)).toEqual(
        expect.arrayContaining([
          `--sovereign-issuance-consolidation=${byFlag.get("--sovereign-issuance-consolidation")}`,
          `--domestic-sovereign-bond-coverage=${byFlag.get("--domestic-sovereign-bond-coverage")}`,
        ])
      );
    }
  });
});
