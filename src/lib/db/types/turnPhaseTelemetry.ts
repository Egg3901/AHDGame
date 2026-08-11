export type TurnPhaseExecutionStatus =
  "pending" | "running" | "completed" | "skipped" | "failed" | "notReached";

export type TurnPhaseSkipReason =
  | "conditional"
  | "featureDisabled"
  | "countryInactive"
  | "upstreamAbort"
  | "manualPause"
  | "simElectionsOnly"
  | "other";

export interface TurnPhaseTelemetry {
  status: TurnPhaseExecutionStatus;
  startedAt: Date | null;
  completedAt: Date | null;
  updatedAt: Date;
  reason: TurnPhaseSkipReason | null;
  message: string | null;
}

export type TurnPhaseTelemetryMap = Record<string, TurnPhaseTelemetry>;
