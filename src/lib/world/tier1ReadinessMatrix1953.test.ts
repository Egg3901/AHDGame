import { describe, expect, it } from "vitest";
import {
  build1953Tier1ReadinessMatrix,
  resolveJapan1953MatrixRow,
  assessProposed1953Tier1Candidate,
} from "./tier1ReadinessMatrix1953";
import {
  PROPOSED_1953_TIER1_ROSTER,
  TIER1_1953_AUTONOMOUS_RECLASSIFICATIONS,
  TIER1_1953_POLICY_DEMOTIONS,
  TIER1_1953_UNCONFIGURED_PROPOSED,
} from "./tier1Readiness1953Data";
import { getWorldEntityOrThrow } from "./worldEntityManifest";

describe("1953 Tier-1 readiness matrix (#3723)", () => {
  const matrix = build1953Tier1ReadinessMatrix();

  it("evaluates all 35 proposed Tier-1 countries for autonomous and player readiness", () => {
    expect(PROPOSED_1953_TIER1_ROSTER).toHaveLength(35);
    expect(matrix.rows).toHaveLength(35);
    expect(matrix.summary.proposedCount).toBe(35);

    for (const row of matrix.rows) {
      expect(row.autonomous === "ready" || row.autonomous === "blocked").toBe(true);
      expect(row.player === "ready" || row.player === "blocked").toBe(true);
    }

    const ids = matrix.rows.map((r) => r.entityId).sort();
    expect(ids).toEqual([...PROPOSED_1953_TIER1_ROSTER.map((r) => r.entityId)].sort());
  });

  it("attaches capability id and follow-up issue to every hard blocker", () => {
    for (const row of matrix.rows) {
      for (const blocker of row.hardBlockers) {
        expect(blocker.capabilityId.length).toBeGreaterThan(0);
        expect(blocker.followUpIssue).toMatch(/^#(\d+|3712\/follow-up\/.+)/);
        expect(blocker.evidence.length).toBeGreaterThan(0);
        expect(blocker.blocks.length).toBeGreaterThan(0);
      }
    }
  });

  it("requires player-ready rows to have passing evidence on all hard mechanical capabilities", () => {
    const playerReady = matrix.rows.filter((r) => r.player === "ready");
    expect(playerReady.length).toBeGreaterThan(0);

    for (const row of playerReady) {
      expect(row.autonomous).toBe("ready");
      expect(row.hardBlockers).toEqual([]);
      expect(row.contractReport).not.toBeNull();
      const mechanical = row.contractReport!.capabilities.filter(
        (c) => c.kind === "mechanical" && c.status !== "not-required"
      );
      expect(mechanical.every((c) => c.present && c.status === "pass")).toBe(true);
    }
  });

  it("reclassifies autonomous-blocked candidates to Tier 2 and records it on the manifest", () => {
    const reclassified = matrix.rows.filter((r) => r.reclassification !== null);
    expect(reclassified.length).toBe(
      TIER1_1953_AUTONOMOUS_RECLASSIFICATIONS.length +
        TIER1_1953_UNCONFIGURED_PROPOSED.length +
        TIER1_1953_POLICY_DEMOTIONS.length
    );
    expect(reclassified).toHaveLength(13);

    // Only the 12 unconfigured proposed Tier-1 entities are demoted for a
    // readiness reason (autonomous-blocked, no CountryConfig). Policy
    // demotions (ES) pass every readiness probe and have a real CountryConfig
    // — see the next test.
    const readinessBlocked = reclassified.filter((r) => r.autonomous === "blocked");
    expect(readinessBlocked.every((r) => !r.hasCountryConfig)).toBe(true);
    expect(readinessBlocked).toHaveLength(12);

    for (const row of readinessBlocked) {
      expect(row.appliedTier).toBe("sphere-macro");
      expect(row.reclassification?.proposedTier).toBe("full-autonomous");
      expect(row.reclassification?.appliedTier).toBe("sphere-macro");
      expect(row.reclassification?.followUpIssues.length).toBeGreaterThan(0);

      const manifest = getWorldEntityOrThrow("1953-default", row.entityId);
      expect(manifest.simulationTier).toBe("sphere-macro");
      expect(manifest.tierReclassification).toMatchObject({
        proposedTier: "full-autonomous",
        appliedTier: "sphere-macro",
      });
      expect(manifest.readiness.autonomous).toBe("blocked");
      expect(manifest.readiness.player).toBe("blocked");
      expect(manifest.readiness.hardBlockers.length).toBeGreaterThan(0);
    }
  });

  it("demotes Spain to sphere-macro for 1953 by policy decision, not a readiness gap (owner call, 2026-07-28)", () => {
    const report = assessProposed1953Tier1Candidate("ES");
    // The readiness contract still reports Spain exactly like FR/IT/SE/TR —
    // autonomous-ready, player-blocked only on adminDiagnostics. The demotion
    // below is a deliberate product decision layered on top, not evidence
    // that these probes missed something.
    expect(report.autonomous).toBe("ready");
    expect(report.player).toBe("blocked");
    expect(report.hardBlockers.map((b) => b.capabilityId)).toEqual(["adminDiagnostics"]);

    const row = matrix.rows.find((r) => r.entityId === "ES");
    expect(row).toMatchObject({
      autonomous: "ready",
      player: "blocked",
      appliedTier: "sphere-macro",
      hasCountryConfig: true,
    });
    expect(row?.reclassification).toMatchObject({
      proposedTier: "full-autonomous",
      appliedTier: "sphere-macro",
    });

    const manifest = getWorldEntityOrThrow("1953-default", "ES");
    expect(manifest.simulationTier).toBe("sphere-macro");
    expect(manifest.legacyAccess).toBe("hidden");
    // Unlike the readiness-blocked reclassifications above, the manifest's
    // own tierReclassification field stays absent: this was never a
    // readiness-matrix demotion, so there is no capability gap to record.
    expect(manifest.tierReclassification).toBeUndefined();
  });

  it("re-promotes FR/IT/SE/TR to full-autonomous via live contract evaluation", () => {
    for (const entityId of ["FR", "IT", "SE", "TR"] as const) {
      const report = assessProposed1953Tier1Candidate(entityId);
      expect(report.autonomous).toBe("ready");
      expect(report.player).toBe("blocked");
      expect(report.hardBlockers.map((b) => b.capabilityId)).toEqual(["adminDiagnostics"]);

      const row = matrix.rows.find((r) => r.entityId === entityId);
      expect(row).toMatchObject({
        autonomous: "ready",
        player: "blocked",
        appliedTier: "full-autonomous",
        reclassification: null,
      });

      const manifest = getWorldEntityOrThrow("1953-default", entityId);
      expect(manifest.simulationTier).toBe("full-autonomous");
      expect(manifest.legacyAccess).toBe("economy-preview");
      expect(manifest.tierReclassification).toBeUndefined();
      expect(manifest.readiness).toMatchObject({
        autonomous: "ready",
        player: "blocked",
      });
      expect(manifest.readiness.hardBlockers.some((b) => b.startsWith("adminDiagnostics"))).toBe(
        true
      );
    }
  });

  it("keeps reclassification capability lists aligned with live contract evaluation", () => {
    for (const plan of TIER1_1953_AUTONOMOUS_RECLASSIFICATIONS) {
      const report = assessProposed1953Tier1Candidate(plan.entityId);
      expect(report.autonomous).toBe("blocked");
      const autoBlockers = report.hardBlockers
        .filter((b) =>
          report.capabilities
            .find((c) => c.capabilityId === b.capabilityId)
            ?.requiredFor.includes("autonomous")
        )
        .map((b) => b.capabilityId)
        .sort();
      expect(autoBlockers).toEqual([...plan.autonomousBlockerCapabilityIds].sort());
    }
  });

  it("explicitly resolves Japan 1953 as autonomous-ready and player-blocked", () => {
    const japan = resolveJapan1953MatrixRow();
    expect(japan.autonomous).toBe("ready");
    expect(japan.player).toBe("blocked");
    expect(japan.appliedTier).toBe("full-autonomous");
    expect(japan.reclassification).toBeNull();
    expect(japan.hardBlockers.map((b) => b.capabilityId)).toContain("adminDiagnostics");
    expect(japan.hardBlockers[0]?.followUpIssue).toMatch(/JP\/adminDiagnostics/);

    const manifest = getWorldEntityOrThrow("1953-default", "JP");
    expect(manifest.simulationTier).toBe("full-autonomous");
    expect(manifest.readiness).toMatchObject({
      autonomous: "ready",
      player: "blocked",
    });
    expect(manifest.readiness.hardBlockers.some((b) => b.startsWith("adminDiagnostics"))).toBe(
      true
    );
    expect(manifest.tierReclassification).toBeUndefined();
  });

  it("promotes Nigeria 1953 to full-autonomous via live contract evaluation", () => {
    const report = assessProposed1953Tier1Candidate("NG");
    expect(report.autonomous).toBe("ready");
    expect(report.player).toBe("ready");
    expect(report.hardBlockers).toEqual([]);

    const row = matrix.rows.find((r) => r.entityId === "NG");
    expect(row).toMatchObject({
      autonomous: "ready",
      player: "ready",
      appliedTier: "full-autonomous",
      reclassification: null,
      hasCountryConfig: true,
    });

    const manifest = getWorldEntityOrThrow("1953-default", "NG");
    expect(manifest).toMatchObject({
      status: "sovereign",
      simulationTier: "full-autonomous",
      legacyAccess: "economy-preview",
      un: { state: "eligible", expectedAdmissionYear: 1960 },
      readiness: { autonomous: "ready", player: "ready" },
    });
    expect(manifest.parentEntityId).toBeUndefined();
    expect(manifest.readiness.hardBlockers).toEqual([]);
    expect(manifest.tierReclassification).toBeUndefined();
  });

  it("promotes Eastern bloc 1953 to full-autonomous via live contract evaluation", () => {
    for (const entityId of ["PL", "CS", "HU", "RO", "BG", "YU"] as const) {
      const report = assessProposed1953Tier1Candidate(entityId);
      expect(report.autonomous).toBe("ready");
      expect(report.player).toBe("ready");
      expect(report.hardBlockers).toEqual([]);
      expect(report.archetypes).toEqual(expect.arrayContaining(["one-party", "planned-economy"]));

      const row = matrix.rows.find((r) => r.entityId === entityId);
      expect(row).toMatchObject({
        autonomous: "ready",
        player: "ready",
        appliedTier: "full-autonomous",
        reclassification: null,
        hasCountryConfig: true,
      });

      const manifest = getWorldEntityOrThrow("1953-default", entityId);
      expect(manifest).toMatchObject({
        simulationTier: "full-autonomous",
        economicArchetype: "planned",
        legacyAccess: "economy-preview",
        readiness: { autonomous: "ready", player: "ready" },
      });
      expect(manifest.tierReclassification).toBeUndefined();
    }
  });

  it("is deterministic across repeated builds", () => {
    const a = JSON.stringify(build1953Tier1ReadinessMatrix());
    const b = JSON.stringify(build1953Tier1ReadinessMatrix());
    expect(a).toBe(b);
  });
});
