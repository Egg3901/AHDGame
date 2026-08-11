import { describe, expect, it } from "vitest";
import {
  buildTier1ReadinessMatrixDiagnostic,
  buildTier1ReadinessMatrixDiagnosticNow,
} from "./tier1ReadinessMatrixReport";

describe("tier1 readiness matrix admin diagnostic", () => {
  it("publishes a consumable report with checks for every proposed country", () => {
    const report = buildTier1ReadinessMatrixDiagnostic();
    expect(report.presetId).toBe("1953-default");
    expect(report.issue).toBe("#3723");
    expect(report.matrix.rows).toHaveLength(35);
    expect(report.checks).toHaveLength(35);
    expect(report.summary.proposedCount).toBe(35);
    // 23 configured countries autonomous-ready (20 plus the three Soviet union
    // republics UKR/BLR/BAL, promoted alongside the satellites); 12 unconfigured
    // + 1 policy demotion (ES, see #3723-follow-up owner decision 2026-07-28)
    // stay demoted to sphere-macro — 13 total reclassified.
    expect(report.summary.autonomousReady).toBe(23);
    expect(report.summary.reclassified).toBe(13);
    expect(report.summary.unconfigured).toBe(12);
    for (const entityId of [
      "FR",
      "IT",
      "SE",
      "TR",
      "NG",
      "PL",
      "CS",
      "HU",
      "RO",
      "BG",
      "YU",
    ] as const) {
      const row = report.matrix.rows.find((r) => r.entityId === entityId);
      expect(row).toMatchObject({
        autonomous: "ready",
        appliedTier: "full-autonomous",
        reclassification: null,
      });
    }
    // ES: autonomous-ready like its former siblings above, but demoted to
    // sphere-macro by policy decision, not a readiness gap.
    const es = report.matrix.rows.find((r) => r.entityId === "ES");
    expect(es).toMatchObject({
      autonomous: "ready",
      appliedTier: "sphere-macro",
    });
    expect(es?.reclassification).not.toBeNull();
  });

  it("stamps ranAt when requested by the route helper", () => {
    const now = new Date("1953-01-01T00:00:00.000Z");
    expect(buildTier1ReadinessMatrixDiagnosticNow(now).ranAt).toBe(now.toISOString());
  });
});
