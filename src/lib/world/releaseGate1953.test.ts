import { describe, expect, it } from "vitest";
import { DEFAULT_SPHERE_BOUNDS } from "@/lib/world/spheres";
import {
  RELEASE_GATE_TARGET_TURNS,
  formatReleaseGate1953Markdown,
  releaseGate1953Passed,
  runKernelHorizon,
  runReleaseGate1953,
} from "./releaseGate1953";

describe("1953 world-tier release gate (#3729)", () => {
  it("runs a deterministic 1,000-turn kernel horizon with bounded ledgers", () => {
    const kernel = runKernelHorizon(RELEASE_GATE_TARGET_TURNS);

    expect(kernel.turnsSimulated).toBe(1000);
    expect(kernel.deterministic).toBe(true);
    expect(kernel.fingerprintA).toBe(kernel.fingerprintB);
    expect(kernel.maxPerEntityFlowPerTurn).toBeLessThanOrEqual(
      DEFAULT_SPHERE_BOUNDS.maxTotalFlowsPerEntityPerTurn + 1e-6
    );
    expect(kernel.maxAlignment).toBeLessThanOrEqual(1);
    expect(kernel.maxIntegration).toBeLessThanOrEqual(1);
    expect(kernel.ghanaSovereigntyYear).toBe(1957);
    expect(kernel.ghanaUnStateAtSovereignty).toBe("admitted");
    // Pinned rather than a ">30" floor: the roster dropped from 33 to 30 when
    // AT/FI/GR were promoted to full-autonomous (they carry real authored
    // party seeds), and a soft floor let that pass unremarked in one direction
    // while failing in the other. An exact count catches roster drift either way.
    // ES later added one macro slot, while Ireland's Tier 1 promotion removed
    // one again. Ireland runs authored sectors and autonomous politics instead.
    expect(kernel.macroCountries).toBe(30);
  });

  it("passes every non-deferred gate check", () => {
    const report = runReleaseGate1953();

    expect(releaseGate1953Passed(report)).toBe(true);
    expect(report.summary.failed).toBe(0);
    expect(report.summary.blocked).toBe(0);
    expect(report.proceed1979).toBe("hold");

    const byId = Object.fromEntries(report.checks.map((c) => [c.id, c]));
    expect(byId.coverage?.status).toBe("pass");
    expect(byId["macro-no-modern-fallback"]?.status).toBe("pass");
    expect(byId["player-readiness"]?.status).toBe("pass");
    expect(byId["npp-staggering"]?.status).toBe("pass");
    expect(byId["player-handoff"]?.status).toBe("pass");
    expect(byId["decolonization-un"]?.status).toBe("pass");
    expect(byId["kernel-horizon"]?.status).toBe("pass");
    expect(byId["live-engine-1000"]?.status).toBe("deferred");
  });

  it("renders a markdown report with proceed/hold and blockers", () => {
    const report = runReleaseGate1953({ kernelTurns: 48 });
    const md = formatReleaseGate1953Markdown(report);
    expect(md).toContain("# World tiers: 1953 release gate (#3729)");
    expect(md).toContain("1979 expansion: HOLD");
    expect(md).toContain("#3703");
  });
});
