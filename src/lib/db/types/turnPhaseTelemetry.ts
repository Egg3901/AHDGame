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
  /**
   * Largest command sources, recorded for phases with at least
   * TOP_COLLECTIONS_MIN_ROUND_TRIPS round trips so N+1s are visible without a
   * profiled replay (#2689).
   */
  topCollections?: Array<{ collection: string; roundTrips: number }>;
  /** Wall time and round trips per named sequential segment of the phase (#2689). */
  substeps?: Record<string, { ms: number; roundTrips?: number; calls: number }>;
}

export type TurnPhaseTelemetryMap = Record<string, TurnPhaseTelemetry>;
