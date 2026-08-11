import { MS_PER_TURN } from "@/lib/constants/turnTime";

/** Options for {@link computeGameNow}. */
export interface ComputeGameNowOptions {
  /**
   * Fast-mode runs turns every 30 min but advances the calendar one game-hour
   * per turn, so the LARP clock intentionally pulls ahead of real time. Pass the
   * live `gameState.fastMode` flag. Defaults to `false` (normal hourly cadence).
   */
  fastMode?: boolean;
}

/**
 * The game-clock instant to stamp for a turn.
 *
 * **Normal mode (default):** the LARP clock tracks real wall-clock time, only
 * ever moving strictly forward (never backward, to keep event timestamps
 * ordered). When the clock has fallen behind (drift/pause) it snaps up to real
 * time — catch-up with no extra turns. Crucially, when the clock is running
 * *ahead* of real time it advances only minimally, so wall-clock catches up and
 * any accumulated offset self-heals over the next turn or two. This prevents a
 * past fast-mode session (or a sub-hour cron burst) from leaving the clock
 * permanently ratcheted ahead of real time — the bug that desynced
 * `lastTurnProcessed` from the real timestamps `realDateToTurn` anchors against.
 *
 * **Fast-mode:** advances at least one game-hour (MS_PER_TURN) per turn, pulling
 * ahead of real time (turns fire every 30 min). This intentional pull-ahead is
 * preserved unchanged; normal mode heals it once fast-mode ends.
 *
 * Monotonic in both modes: the result is always strictly greater than
 * `lastProcessed`, so the clock never runs backward.
 */
export function computeGameNow(
  lastTurnProcessed: Date | string | null | undefined,
  nowMs: number,
  opts?: ComputeGameNowOptions
): Date {
  // Fresh game (no prior turn): anchor the LARP clock at real time.
  if (lastTurnProcessed == null) return new Date(nowMs);

  const lastProcessedMs = new Date(lastTurnProcessed).getTime();

  if (opts?.fastMode) {
    // Intentional pull-ahead: exactly one game-hour per turn (or snap up if
    // somehow behind), never backward.
    return new Date(Math.max(lastProcessedMs + MS_PER_TURN, nowMs));
  }

  // Normal mode: track real time. `+ 1` keeps it strictly forward so a clock
  // that is currently ahead of real time advances minimally (letting wall-clock
  // overtake and the offset self-heal) instead of ratcheting another hour ahead.
  return new Date(Math.max(lastProcessedMs + 1, nowMs));
}
