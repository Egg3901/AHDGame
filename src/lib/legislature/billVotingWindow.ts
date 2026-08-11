/**
 * Bills only transition out of their voting statuses ("active" / "active_other" / "veto_override")
 * when the hourly turn cron runs the bill lifecycle phase. Between voting closing and the
 * next turn processing the bill, the DB status is stale. UI that gates voting on `status` alone
 * will keep the voting UI visible while the server-side vote route already rejects the vote with
 * "Voting has ended" — `isVotingDeadlinePassed` lets callers reconcile that stale status with
 * the deadline.
 *
 * Prefers the game-clock turn check (`deadlineTurn` vs `currentTurn`) so vote acceptance and
 * cron resolution agree even when the game clock drifts behind real time. Falls back to a
 * date comparison for legacy docs that pre-date the turn-number migration.
 */
export function isVotingDeadlinePassed(
  deadline: string | Date | null | undefined,
  now: Date = new Date(),
  deadlineTurn?: number | null,
  currentTurn?: number | null
): boolean {
  if (typeof deadlineTurn === "number" && typeof currentTurn === "number") {
    return currentTurn >= deadlineTurn;
  }
  if (!deadline) return false;
  const ms = typeof deadline === "string" ? Date.parse(deadline) : deadline.getTime();
  if (Number.isNaN(ms)) return false;
  return ms <= now.getTime();
}
