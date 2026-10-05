/**
 * Shared constructors for diagnostic checks.
 *
 * Extracted from `conformance.ts` so a second check module can build checks
 * without importing that file (which would be a cycle: the runner imports the
 * check modules, not the other way round).
 */
import type { SeedDiagnosticCheck, SeedDiagnosticSeverity } from "./types";
import { CONFORMANCE_REL_TOL, withinRelTol } from "./tolerance";

export function check(
  id: string,
  scope: string,
  metric: string,
  expected: number | string | null,
  actual: number | string | null,
  severity: SeedDiagnosticSeverity,
  note?: string
): SeedDiagnosticCheck {
  return { id, scope, metric, expected, actual, severity, note };
}

export function ok(
  id: string,
  scope: string,
  metric: string,
  expected: number | string | null,
  actual: number | string | null,
  note?: string
): SeedDiagnosticCheck {
  return check(id, scope, metric, expected, actual, "ok", note);
}

export function warn(
  id: string,
  scope: string,
  metric: string,
  expected: number | string | null,
  actual: number | string | null,
  note?: string
): SeedDiagnosticCheck {
  return check(id, scope, metric, expected, actual, "warn", note);
}

export function critical(
  id: string,
  scope: string,
  metric: string,
  expected: number | string | null,
  actual: number | string | null,
  note?: string
): SeedDiagnosticCheck {
  return check(id, scope, metric, expected, actual, "critical", note);
}

export function relCheck(
  id: string,
  scope: string,
  metric: string,
  expected: number,
  actual: number | null | undefined,
  tol: number = CONFORMANCE_REL_TOL,
  note?: string
): SeedDiagnosticCheck {
  if (actual == null || !Number.isFinite(actual)) {
    return critical(id, scope, metric, expected, actual ?? null, note ?? "missing actual");
  }
  if (withinRelTol(actual, expected, tol)) {
    return ok(id, scope, metric, expected, actual, note);
  }
  const drift = Math.abs(actual - expected) / Math.max(Math.abs(expected), 1e-9);
  return critical(
    id,
    scope,
    metric,
    expected,
    actual,
    note ?? `drift ${(drift * 100).toFixed(2)}% > ${(tol * 100).toFixed(1)}% tol`
  );
}
