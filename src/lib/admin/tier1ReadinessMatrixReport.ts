/**
 * Admin diagnostics read model for the 1953 Tier-1 readiness matrix (#3723).
 *
 * Mirrors the seed-diagnostic / npp-v1-readiness style: a pure report builder
 * consumed by an admin GET route.
 */

import {
  build1953Tier1ReadinessMatrix,
  type Tier1MatrixRow,
  type Tier1ReadinessMatrix1953,
} from "@/lib/world/tier1ReadinessMatrix1953";

export interface Tier1ReadinessMatrixDiagnosticCheck {
  name: string;
  severity: "ok" | "warn" | "critical";
  detail: string;
}

export interface Tier1ReadinessMatrixDiagnosticReport {
  presetId: string;
  issue: string;
  ranAt: string;
  summary: Tier1ReadinessMatrix1953["summary"];
  checks: Tier1ReadinessMatrixDiagnosticCheck[];
  matrix: Tier1ReadinessMatrix1953;
}

function rowCheck(row: Tier1MatrixRow): Tier1ReadinessMatrixDiagnosticCheck {
  if (row.reclassification) {
    return {
      name: `${row.entityId} reclassified`,
      severity: "warn",
      detail: `${row.displayName}: proposed Tier 1 → ${row.appliedTier}. ${row.reclassification.reason}`,
    };
  }
  if (row.player === "ready") {
    return {
      name: `${row.entityId} player-ready`,
      severity: "ok",
      detail: `${row.displayName}: autonomous and player ready (${row.archetypes.join("+") || "n/a"}).`,
    };
  }
  if (row.autonomous === "ready") {
    const blockers = row.hardBlockers
      .map((b) => `${b.capabilityId} (${b.followUpIssue})`)
      .join(", ");
    return {
      name: `${row.entityId} autonomous-only`,
      severity: "warn",
      detail: `${row.displayName}: autonomous-ready, player-blocked — ${blockers}`,
    };
  }
  const blockers = row.hardBlockers.map((b) => `${b.capabilityId} (${b.followUpIssue})`).join(", ");
  return {
    name: `${row.entityId} blocked`,
    severity: "critical",
    detail: `${row.displayName}: autonomous-blocked — ${blockers}`,
  };
}

function buildReport(ranAt: string): Tier1ReadinessMatrixDiagnosticReport {
  const matrix = build1953Tier1ReadinessMatrix();
  return {
    presetId: matrix.presetId,
    issue: matrix.issue,
    ranAt,
    summary: matrix.summary,
    checks: matrix.rows.map(rowCheck),
    matrix,
  };
}

/**
 * Build the admin-facing 1953 Tier-1 readiness matrix diagnostic.
 * Deterministic matrix body; `ranAt` fixed for pure unit tests.
 */
export function buildTier1ReadinessMatrixDiagnostic(): Tier1ReadinessMatrixDiagnosticReport {
  return buildReport("1970-01-01T00:00:00.000Z");
}

/** Route helper: stamp a fresh ranAt while keeping the matrix deterministic. */
export function buildTier1ReadinessMatrixDiagnosticNow(
  now = new Date()
): Tier1ReadinessMatrixDiagnosticReport {
  return buildReport(now.toISOString());
}
