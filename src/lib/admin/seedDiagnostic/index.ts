/**
 * Seed self-diagnostic orchestrator.
 *
 * Mode A (conformance) + Mode B (drift) + baseline capture.
 */

import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { runConformanceChecks } from "./conformance";
import { runDriftChecks } from "./drift";
import type { RunSeedDiagnosticOptions, SeedDiagnosticCheck, SeedDiagnosticReport } from "./types";
import { calendarTurnFromGameState } from "./types";
import { DEFAULT_SEED_PRESET } from "@/lib/constants/seedPreset";

export type {
  RunSeedDiagnosticOptions,
  SeedDiagnosticCheck,
  SeedDiagnosticMode,
  SeedDiagnosticReport,
  SeedDiagnosticSeverity,
  SeedDiagnosticTrigger,
} from "./types";

export { calendarTurnFromGameState } from "./types";
export { captureSeedBaseline, loadSeedBaseline } from "./baseline";
export type { SeedDiagnosticBaseline } from "./baseline";

const REPORT_COLLECTION = "seedDiagnostics";
const MAX_REPORTS = 50;

function summarize(checks: SeedDiagnosticCheck[]): SeedDiagnosticReport["summary"] {
  let ok = 0;
  let warn = 0;
  let critical = 0;
  for (const c of checks) {
    if (c.severity === "ok") ok++;
    else if (c.severity === "warn") warn++;
    else critical++;
  }
  return { ok, warn, critical };
}

/**
 * Persist a report and prune older ones so the collection stays capped at
 * {@link MAX_REPORTS}.
 */
async function persistReport(db: Db, report: SeedDiagnosticReport): Promise<void> {
  await db.collection(REPORT_COLLECTION).insertOne(report as never);
  const keep = await db
    .collection(REPORT_COLLECTION)
    .find({})
    .sort({ ranAt: -1 })
    .project({ _id: 1 })
    .limit(MAX_REPORTS)
    .toArray();
  const keepIds = keep.map((d) => d._id);
  if (keepIds.length >= MAX_REPORTS) {
    await db.collection(REPORT_COLLECTION).deleteMany({ _id: { $nin: keepIds } });
  }
}

/**
 * Run the seed diagnostic (conformance or drift) and optionally persist.
 */
export async function runSeedDiagnostic(
  db: Db,
  opts: RunSeedDiagnosticOptions
): Promise<SeedDiagnosticReport> {
  const now = opts.now ?? new Date();
  const trigger = opts.trigger ?? "manual";
  const gs = await db
    .collection<{
      preset?: string;
      currentTurn?: number;
      preIterationTurns?: number;
    }>("gameState")
    .findOne({ _id: "current" as never });
  const preset =
    opts.preset ?? (typeof gs?.preset === "string" ? gs.preset : null) ?? DEFAULT_SEED_PRESET;
  const turn = typeof gs?.currentTurn === "number" ? gs.currentTurn : 1;
  const calendarTurn = calendarTurnFromGameState(gs);

  let checks: SeedDiagnosticCheck[] = [];
  let note: string | undefined;

  if (opts.mode === "conformance") {
    const result = await runConformanceChecks(db, { preset });
    checks = result.checks;
  } else {
    const result = await runDriftChecks(db, { preset, calendarTurn });
    checks = result.checks;
    note = result.note;
  }

  const report: SeedDiagnosticReport = {
    _id: new ObjectId(),
    ranAt: now,
    mode: opts.mode,
    trigger,
    preset,
    turn,
    calendarTurn,
    summary: summarize(checks),
    checks,
    ...(note ? { note } : {}),
  };

  if (opts.persist !== false) {
    await persistReport(db, report);
  }

  return report;
}

/** How many critical ids to name inline before collapsing the rest to a count. */
const MAX_NAMED_CRITICALS = 5;

/**
 * Format a one-line summary for SSE / reset logs.
 *
 * Criticals are named, not just counted. The summary line is usually the only
 * trace a reset leaves behind — the report itself is capped at
 * {@link MAX_REPORTS} and a scratch/profiling database is often dropped on the
 * way out — so a bare "1 critical" leaves no way to tell which check failed
 * without seeding the world again.
 */
export function formatDiagnosticSummary(report: SeedDiagnosticReport): string {
  const { ok, warn, critical } = report.summary;
  const line = `Seed diagnostic (${report.mode}): ${ok} ok, ${warn} warn, ${critical} critical`;
  if (critical === 0) return line;

  const ids = report.checks.filter((c) => c.severity === "critical").map((c) => c.id);
  const named = ids.slice(0, MAX_NAMED_CRITICALS);
  const rest = ids.length - named.length;
  return `${line} — ${named.join(", ")}${rest > 0 ? ` (+${rest} more)` : ""}`;
}

/**
 * Build a critical diagnostic_error report when the diagnostic itself throws.
 * Never used to abort a reset — callers wrap runSeedDiagnostic in try/catch.
 */
export function diagnosticErrorReport(
  message: string,
  opts?: {
    preset?: string;
    trigger?: SeedDiagnosticReport["trigger"];
    now?: Date;
  }
): SeedDiagnosticReport {
  const checks: SeedDiagnosticCheck[] = [
    {
      id: "diagnostic_error",
      scope: "global",
      metric: "diagnostic",
      expected: "success",
      actual: "threw",
      severity: "critical",
      note: message,
    },
  ];
  return {
    _id: new ObjectId(),
    ranAt: opts?.now ?? new Date(),
    mode: "conformance",
    trigger: opts?.trigger ?? "post-reset",
    preset: opts?.preset ?? "unknown",
    turn: 0,
    calendarTurn: 0,
    summary: summarize(checks),
    checks,
  };
}
