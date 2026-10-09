import type { TurnOutcome, TurnPhaseTelemetryMap } from "@/lib/db/types/turnPhaseTelemetry";

/** Market freshness uses phase telemetry's wall clock, including on a resumed turn. */
export function completedMarketUpdateAt(phaseStatuses: TurnPhaseTelemetryMap): Date | null {
  const phase = phaseStatuses.stockExchangeSnapshot;
  if (phase?.status !== "completed" || !phase.completedAt) return null;
  return Number.isFinite(phase.completedAt.getTime()) ? phase.completedAt : null;
}

export interface TurnCompletionStatus {
  success: true;
  outcome: TurnOutcome;
  failedPhases: string[];
  /** Phases skipped because a phase they depend on failed. */
  abortedPhases: string[];
  warningCount: number;
}

/**
 * A turn that reaches the commit path is committed (`success`). A phase that
 * threw is logged and skipped so the world keeps moving, which is why a
 * committed turn is not automatically a healthy one: `outcome` and
 * `failedPhases` say whether every phase actually finished. Exceptions and
 * rejected locks return from separate failure paths.
 */
export function completedTurnStatus(
  warnings: readonly string[],
  phaseStatuses: TurnPhaseTelemetryMap = {}
): TurnCompletionStatus {
  const failedPhases = Object.entries(phaseStatuses)
    .filter(([, status]) => status?.status === "failed")
    .map(([phase]) => phase)
    .sort();
  const abortedPhases = Object.entries(phaseStatuses)
    .filter(([, status]) => status?.status === "skipped" && status.reason === "upstreamAbort")
    .map(([phase]) => phase)
    .sort();
  return {
    success: true,
    outcome: failedPhases.length + abortedPhases.length > 0 ? "degraded" : "clean",
    failedPhases,
    abortedPhases,
    warningCount: warnings.length,
  };
}
