export interface ElectionPhaseStatusSummary {
  status: string;
  inPrimary: boolean;
  startTime: string | null;
  endTime: string | null;
  primaryEndTime: string | null;
  // Turn-based deadlines — preferred for the strip's countdown (drift-free,
  // freeze on pause). Null on legacy rows; the strip falls back to timestamps.
  startTurn: number | null;
  endTurn: number | null;
  primaryEndTurn: number | null;
}

interface ElectionPhaseStatusSource {
  status: string;
  inPrimary?: boolean | null;
  startTime?: string | Date | null;
  endTime?: string | Date | null;
  primaryEndTime?: string | Date | null;
  startTurn?: number | null;
  endTurn?: number | null;
  primaryEndTurn?: number | null;
}

function toIsoString(value?: string | Date | null): string | null {
  if (!value) return null;
  if (typeof value === "string") return value;
  return value.toISOString();
}

/**
 * Shapes the small, timer-focused election payload used by card UIs so we
 * can reuse the same primary/general phase block outside the main elections
 * pages without hauling the full election display object around.
 */
export function buildElectionPhaseStatusSummary(
  election: ElectionPhaseStatusSource
): ElectionPhaseStatusSummary {
  return {
    status: election.status,
    inPrimary: !!election.inPrimary,
    startTime: toIsoString(election.startTime),
    endTime: toIsoString(election.endTime),
    primaryEndTime: toIsoString(election.primaryEndTime),
    startTurn: election.startTurn ?? null,
    endTurn: election.endTurn ?? null,
    primaryEndTurn: election.primaryEndTurn ?? null,
  };
}
