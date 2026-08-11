import type { ObjectId } from "mongodb";

export type SeedDiagnosticMode = "conformance" | "drift";
export type SeedDiagnosticTrigger = "post-reset" | "manual";
export type SeedDiagnosticSeverity = "ok" | "warn" | "critical";

export interface SeedDiagnosticCheck {
  id: string;
  scope: string;
  metric: string;
  expected: number | string | null;
  actual: number | string | null;
  driftPct?: number;
  tolerancePct?: number;
  severity: SeedDiagnosticSeverity;
  note?: string;
}

export interface SeedDiagnosticReport {
  _id: ObjectId;
  ranAt: Date;
  mode: SeedDiagnosticMode;
  trigger: SeedDiagnosticTrigger;
  preset: string;
  turn: number;
  calendarTurn: number;
  summary: { ok: number; warn: number; critical: number };
  checks: SeedDiagnosticCheck[];
  /** Present when Mode B reconstructed baseline from seed files. */
  note?: string;
}

export interface RunSeedDiagnosticOptions {
  mode: SeedDiagnosticMode;
  trigger?: SeedDiagnosticTrigger;
  /** Override preset (otherwise read from gameState). */
  preset?: string;
  /** Injected clock for tests. */
  now?: Date;
  /** When false, skip persisting the report (tests). Default true. */
  persist?: boolean;
}

/**
 * Calendar turn excluding pre-iteration founding turns. Used for Mode B
 * tolerance ramp and trajectory compounding (and reported on every report).
 */
export function calendarTurnFromGameState(
  gs: {
    currentTurn?: number;
    preIterationTurns?: number;
  } | null
): number {
  const currentTurn = typeof gs?.currentTurn === "number" ? gs.currentTurn : 1;
  const pre = typeof gs?.preIterationTurns === "number" ? gs.preIterationTurns : 0;
  return Math.max(1, currentTurn - pre);
}
