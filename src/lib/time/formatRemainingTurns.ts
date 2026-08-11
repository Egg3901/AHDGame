import { MS_PER_TURN } from "@/lib/constants/turnTime";
import { formatTimeRemaining, type TimeRemaining } from "@/lib/utils/formatters";

/**
 * Compact wall-clock estimate for a whole number of turns (1 turn = 1 game-hour).
 * "2h", "1d", "1d 1h" — the parenthetical in the turn-countdown label.
 */
function compactTurnDuration(turns: number): string {
  const days = Math.floor(turns / 24);
  const hours = turns % 24;
  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  return `${hours}h`;
}

/**
 * Turn-first countdown label shared by the client (`useGameClock`) and server
 * (`gameClock.server`) clock facades, so both render identically.
 *
 * Turns are the source of truth — drift-immune and frozen on pause — so the
 * label leads with the turn count and shows the hour figure only as an
 * approximate wall-clock estimate (e.g. "2 turns (~2h)"). This keeps the
 * countdown legible as discrete steps: it changes once per turn rather than
 * looking like a frozen wall-clock timer. Urgency reuses the existing
 * `formatTimeRemaining` thresholds so warning/critical coloring is unchanged.
 */
export function formatRemainingTurns(
  targetTurn: number | null | undefined,
  currentTurn: number
): TimeRemaining {
  if (targetTurn == null) return { text: "No timer", urgency: "normal" };
  const remainingTurns = targetTurn - currentTurn;
  if (remainingTurns <= 0) return { text: "Ended", urgency: "ended" };
  // Urgency only — the SOURCE is turns; the synthetic Date is the formatting
  // vehicle for the shared threshold logic.
  const { urgency } = formatTimeRemaining(
    new Date(remainingTurns * MS_PER_TURN),
    null,
    new Date(0)
  );
  const turnLabel = `${remainingTurns} turn${remainingTurns === 1 ? "" : "s"}`;
  return { text: `${turnLabel} (~${compactTurnDuration(remainingTurns)})`, urgency };
}
