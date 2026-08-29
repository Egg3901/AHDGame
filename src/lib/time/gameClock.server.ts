import { getGameTime } from "./gameTime";
import { getDb } from "@/lib/mongodb";
import type { GameState } from "@/lib/db/types";
import {
  formatTimeRemaining,
  formatTimeUntilCompact,
  endTimeToGameYear,
  formatDateLocal,
  type TimeRemaining,
} from "@/lib/utils/formatters";
import { MS_PER_TURN } from "@/lib/constants/turnTime";
import { formatRemainingTurns as formatRemainingTurnsLabel } from "./formatRemainingTurns";

export interface GameClock {
  now: Date;
  realNow: Date;
  lastTurnProcessed: Date;
  pausedAt: Date | null;
  pauseReason: string | null;
  pauseKind: "manual" | "auto-drift" | null;
  currentTurn: number;
  driftMs: number;
  driftHours: number;
  isPaused: boolean;
  isActive: boolean;

  formatRemaining(deadline: Date | string | null | undefined): TimeRemaining;
  formatCompact(deadline: Date | string | null | undefined): string;
  formatYear(timestamp: Date | string | null | undefined): number | null;

  /**
   * Remaining time as a turn-derived countdown: (targetTurn - currentTurn)
   * turns × 1h. Freezes on pause because currentTurn freezes. Use for
   * turn-based deadlines instead of formatRemaining(Date).
   */
  formatRemainingTurns(targetTurn: number | null | undefined): TimeRemaining;

  /**
   * Cosmetic absolute date for a turn-based deadline, re-projected on read:
   * realNow + (targetTurn - currentTurn) × 1h.
   */
  projectTurnToDate(targetTurn: number | null | undefined): Date | null;

  /**
   * Format a game-clock-anchored deadline as the real wall-clock moment it
   * will actually fire. Equivalent to formatDateLocal(deadline) when cron is
   * healthy; shifts forward by driftMs when drifted or paused so the printed
   * date reflects when the deadline will land in real time.
   */
  formatAbsoluteDeadline(deadline: Date | string | null | undefined): string;

  /** Same calculation as formatAbsoluteDeadline, but returns a raw Date. */
  toAbsoluteWallClock(deadline: Date | string | null | undefined): Date | null;
}

/**
 * Build a server-side GameClock. Use in RSC pages and route handlers.
 *
 * For client components, use `useGameClock()` from `src/contexts/useGameClock.ts`
 * instead — the two facades return the same `GameClock` shape so call-site code
 * is identical apart from the import.
 */
export async function getGameClock(): Promise<GameClock> {
  const time = await getGameTime();
  const realNow = new Date();
  const lastTurnProcessed = new Date(time.lastTurnProcessed);
  const pausedAt = time.pausedAt ? new Date(time.pausedAt) : null;
  const now = pausedAt ?? lastTurnProcessed;
  const driftMs = Math.max(0, realNow.getTime() - lastTurnProcessed.getTime());

  const toAbsoluteWallClockImpl = (deadline: Date | string | null | undefined): Date | null => {
    if (!deadline) return null;
    const d = new Date(deadline).getTime();
    if (Number.isNaN(d)) return null;
    return new Date(d + driftMs);
  };

  // getGameTime() doesn't expose pauseReason/pauseKind — read them directly.
  const db = await getDb();
  const gs = await db
    .collection<GameState>("gameState")
    .findOne({ _id: "current" }, { projection: { pauseReason: 1, pauseKind: 1 } });

  return {
    now,
    realNow,
    lastTurnProcessed,
    pausedAt,
    pauseReason: gs?.pauseReason ?? null,
    pauseKind: gs?.pauseKind ?? null,
    currentTurn: time.currentTurn,
    driftMs,
    driftHours: driftMs / 3_600_000,
    isPaused: pausedAt !== null,
    isActive: time.isActive,

    formatRemaining(deadline) {
      if (!deadline) return { text: "No timer", urgency: "normal" };
      return formatTimeRemaining(deadline, pausedAt, now);
    },
    formatCompact(deadline) {
      if (!deadline) return "—";
      return formatTimeUntilCompact(deadline, pausedAt, now);
    },
    formatYear(timestamp) {
      if (!timestamp) return null;
      return endTimeToGameYear(timestamp, time.currentTurn, lastTurnProcessed, time.startingYear, {
        preIterationTurns: time.preIterationTurns,
      });
    },

    formatRemainingTurns(targetTurn) {
      return formatRemainingTurnsLabel(targetTurn, time.currentTurn);
    },
    projectTurnToDate(targetTurn) {
      if (targetTurn == null) return null;
      return new Date(realNow.getTime() + (targetTurn - time.currentTurn) * MS_PER_TURN);
    },

    toAbsoluteWallClock: toAbsoluteWallClockImpl,
    formatAbsoluteDeadline(deadline) {
      const shifted = toAbsoluteWallClockImpl(deadline);
      if (shifted == null) return "—";
      return formatDateLocal(shifted);
    },
  };
}
