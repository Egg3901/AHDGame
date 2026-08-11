import type { TurnPhaseTelemetryMap } from "@/lib/db/types";
import { TURN_PHASE_NAMES } from "@/simulation/phases/turnPhaseNames";

const BOOTSTRAP_PHASES = ["turn_bootstrap"] as const;

export function formatTurnPhaseLabel(phase: string | null | undefined): string {
  if (!phase) return "Starting…";
  return phase.replace(/([A-Z])/g, " $1").trim();
}

export function computeTurnProcessingProgress(
  processingPhase: string | null | undefined,
  processingPhaseStatuses?: TurnPhaseTelemetryMap | null
): number {
  const phaseOrder = [...BOOTSTRAP_PHASES, ...TURN_PHASE_NAMES];
  const total = phaseOrder.length;

  if (processingPhase) {
    const idx = phaseOrder.indexOf(processingPhase as (typeof phaseOrder)[number]);
    if (idx >= 0) {
      return Math.min(98, Math.max(2, Math.round(((idx + 0.5) / total) * 100)));
    }
  }

  const statuses = processingPhaseStatuses ?? {};
  const completed = Object.values(statuses).filter(
    (telemetry) => telemetry.status === "completed" || telemetry.status === "skipped"
  ).length;

  return Math.min(98, Math.round((completed / total) * 100));
}
