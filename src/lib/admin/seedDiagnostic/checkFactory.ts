/**
 * Shared constructors for diagnostic checks.
 *
 * Extracted from `conformance.ts` so a second check module can build checks
 * without importing that file (which would be a cycle: the runner imports the
 * check modules, not the other way round).
 */
import type { SeedDiagnosticCheck, SeedDiagnosticSeverity } from "./types";

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
