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
  /** Mongo commands the phase issued. Always counted; see turnPhaseBudgets.ts. */
  roundTrips?: number;
  /** The phase's round-trip budget at the time it ran. */
  roundTripBudget?: number;
  /** True when roundTrips exceeded roundTripBudget. Warn-only, never fails the turn. */
  overBudget?: boolean;
}

export type TurnPhaseTelemetryMap = Record<string, TurnPhaseTelemetry>;
