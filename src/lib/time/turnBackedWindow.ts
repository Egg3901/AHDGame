export interface TurnBackedWindow {
  startTurn?: number | null;
  endTurn?: number | null;
  startTime?: Date | string | null;
  endTime?: Date | string | null;
}

export interface CreateTurnBackedWindowInput {
  currentTurn: number;
  durationTurns: number;
  effectiveNow: Date;
}

export interface TurnBackedWindowBounds {
  startTurn: number;
  endTurn: number;
  startTime: Date;
  endTime: Date;
}

export function createTurnBackedWindow({
  currentTurn,
  durationTurns,
  effectiveNow,
}: CreateTurnBackedWindowInput): TurnBackedWindowBounds {
  const startTime = new Date(effectiveNow);
  // endTime is retained for display/legacy only and is NOT consulted for
  // resolution or entry gating (see hasTurnBackedWindowClosed). It assumes
  // 1 turn ≈ 1h, which does not hold when turn cadence differs from hourly, so
  // closure decisions are turn-based exclusively.
  const endTime = new Date(startTime.getTime() + durationTurns * 60 * 60 * 1000);

  return {
    startTurn: currentTurn,
    endTurn: currentTurn + durationTurns,
    startTime,
    endTime,
  };
}

export function hasTurnBackedWindowClosed(
  window: TurnBackedWindow,
  currentTurn: number,
  _effectiveNow?: Date
): boolean {
  // Turn-based exclusively. The wall-clock endTime is never used to close a
  // window — under non-hourly turn cadence it arrives long before endTurn and
  // would resolve elections early (the bug this fixes). All party-election docs
  // carry endTurn, so there is no Date fallback to strand.
  return typeof window.endTurn === "number" && currentTurn >= window.endTurn;
}
