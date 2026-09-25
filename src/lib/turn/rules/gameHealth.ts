import type {
  GameHealthQualification,
  GameHealthSeverity,
  GameHealthSummary,
  IntegrityIssue,
} from "@/lib/db/types";

export interface GameHealthRunSummary extends GameHealthSummary {
  completed: boolean;
  turnSuccess: boolean;
}

export interface GameHealthAggregate extends GameHealthSummary {
  completedTurns: number;
  successfulTurns: number;
  completionRate: number;
}

interface GameHealthSnapshotParts {
  health?: GameHealthSummary | null;
  turnProcessing?: {
    success?: boolean;
    warningCount?: number;
    errorCount?: number;
  };
  dataIntegrity?: {
    issues?: Pick<IntegrityIssue, "severity">[];
  } | null;
}

export function summarizeGameHealth(input: {
  turnSuccess: boolean;
  processingWarningCount: number;
  processingErrorCount: number;
  integrityChecked: boolean;
  integrityIssues: readonly Pick<IntegrityIssue, "severity">[];
}): GameHealthSummary {
  const processingWarningCount = nonNegativeInteger(input.processingWarningCount);
  const processingErrorCount = nonNegativeInteger(input.processingErrorCount);
  const integrityWarningCount = input.integrityChecked
    ? input.integrityIssues.filter((issue) => issue.severity === "warning").length
    : 0;
  const integrityErrorCount = input.integrityChecked
    ? input.integrityIssues.filter((issue) => issue.severity === "error").length
    : 0;
  const warningCount = processingWarningCount + integrityWarningCount;
  const errorCount = processingErrorCount + integrityErrorCount;
  const severity: GameHealthSeverity =
    !input.turnSuccess || errorCount > 0 ? "error" : warningCount > 0 ? "warning" : "ok";
  const qualification: GameHealthQualification = !input.integrityChecked
    ? "unverified"
    : integrityErrorCount > 0 || processingErrorCount > 0 || !input.turnSuccess
      ? "non-passing"
      : "passing";

  return {
    severity,
    warningCount,
    errorCount,
    processingWarningCount,
    processingErrorCount,
    integrityWarningCount,
    integrityErrorCount,
    integrityChecked: input.integrityChecked,
    qualification,
  };
}

export function gameHealthRunSummary(snapshot: GameHealthSnapshotParts): GameHealthRunSummary {
  const turnSuccess = snapshot.turnProcessing?.success ?? true;
  const summary =
    snapshot.health ??
    summarizeGameHealth({
      turnSuccess,
      processingWarningCount: snapshot.turnProcessing?.warningCount ?? 0,
      processingErrorCount: snapshot.turnProcessing?.errorCount ?? 0,
      integrityChecked: snapshot.dataIntegrity != null,
      integrityIssues: snapshot.dataIntegrity?.issues ?? [],
    });
  return {
    ...summary,
    completed: true,
    turnSuccess,
  };
}

export function aggregateGameHealth(
  summaries: readonly GameHealthRunSummary[]
): GameHealthAggregate {
  const completedTurns = summaries.length;
  const successfulTurns = summaries.filter((summary) => summary.turnSuccess).length;
  const processingWarningCount = sum(summaries, "processingWarningCount");
  const processingErrorCount = sum(summaries, "processingErrorCount");
  const integrityWarningCount = sum(summaries, "integrityWarningCount");
  const integrityErrorCount = sum(summaries, "integrityErrorCount");
  const warningCount = processingWarningCount + integrityWarningCount;
  const errorCount = processingErrorCount + integrityErrorCount;
  const severity: GameHealthSeverity =
    successfulTurns < completedTurns || errorCount > 0
      ? "error"
      : warningCount > 0
        ? "warning"
        : "ok";
  const qualification: GameHealthQualification = summaries.some(
    (summary) => summary.qualification === "non-passing"
  )
    ? "non-passing"
    : summaries.some((summary) => summary.qualification === "unverified") || completedTurns === 0
      ? "unverified"
      : "passing";

  return {
    severity,
    warningCount,
    errorCount,
    processingWarningCount,
    processingErrorCount,
    integrityWarningCount,
    integrityErrorCount,
    integrityChecked:
      summaries.length > 0 && summaries.every((summary) => summary.integrityChecked),
    qualification,
    completedTurns,
    successfulTurns,
    completionRate: completedTurns === 0 ? 0 : successfulTurns / completedTurns,
  };
}

function nonNegativeInteger(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function sum(
  summaries: readonly GameHealthRunSummary[],
  field:
    | "processingWarningCount"
    | "processingErrorCount"
    | "integrityWarningCount"
    | "integrityErrorCount"
): number {
  return summaries.reduce((total, summary) => total + nonNegativeInteger(summary[field]), 0);
}
