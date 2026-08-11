import type {
  TurnPhaseExecutionStatus,
  TurnPhaseTelemetry,
  TurnPhaseTelemetryMap,
} from "@/lib/db/types";
import { TURN_PHASE_NAMES } from "@/simulation/phases/turnPhaseNames";

export function createTurnPhaseTelemetry(
  now: Date,
  status: TurnPhaseExecutionStatus
): TurnPhaseTelemetry {
  return {
    status,
    startedAt: null,
    completedAt: null,
    updatedAt: now,
    reason: null,
    message: null,
  };
}

export function createInitialTurnPhaseStatuses(): TurnPhaseTelemetryMap {
  return {};
}

export function finalizeAbortedPhaseStatuses(
  phaseStatuses: TurnPhaseTelemetryMap,
  currentPhase: string | null,
  failureTime: Date,
  failureMessage: string
): TurnPhaseTelemetryMap {
  const finalized: TurnPhaseTelemetryMap = { ...phaseStatuses };

  for (const [phase, telemetry] of Object.entries(finalized)) {
    if (telemetry.status !== "running") continue;
    finalized[phase] = {
      ...telemetry,
      status: "failed",
      completedAt: failureTime,
      updatedAt: failureTime,
      reason: "other",
      message: telemetry.message ?? failureMessage,
    };
  }

  const abortMessage = currentPhase
    ? `Phase was never reached because turn processing aborted during "${currentPhase}".`
    : "Phase was never reached because turn processing aborted before later phases could run.";

  for (const phase of TURN_PHASE_NAMES) {
    if (finalized[phase]) continue;
    finalized[phase] = {
      status: "notReached",
      startedAt: null,
      completedAt: failureTime,
      updatedAt: failureTime,
      reason: "upstreamAbort",
      message: abortMessage,
    };
  }

  return finalized;
}
