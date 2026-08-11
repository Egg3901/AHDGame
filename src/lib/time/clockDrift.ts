/**
 * Cron-liveness threshold for the auto-pause guard.
 *
 * The turn cron measures the wall-clock gap since the latest completed
 * `turnLog.realTime`; when it exceeds AUTO_PAUSE_DRIFT_MS, hourly processing
 * has stopped firing (DB outage, crashed processTurn, etc.) and the game
 * auto-pauses for admin investigation.
 *
 * (The old game-clock "warn-drift" tier was removed in the turn-based-deadline
 * migration — deadlines resolve on turns, so a game-clock/wall-clock offset no
 * longer affects anything and never needed a banner. See
 * [[project-turn-based-deadline-migration]].)
 */
export const AUTO_PAUSE_DRIFT_MS = 4 * 3_600_000;

export function isAutoPauseDrift(driftMs: number): boolean {
  return driftMs >= AUTO_PAUSE_DRIFT_MS;
}

/** Render drift as a coarse "N h" string for admin UI. Rounds at half-hour boundaries. */
export function formatDriftHours(driftMs: number): string {
  const hours = Math.round(driftMs / 3_600_000);
  return `${hours} h`;
}
