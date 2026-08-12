"use client";

import { useSyncExternalStore } from "react";
import { useGameTurnStatus } from "@/hooks/useGameEvents";
import {
  formatTimeRemaining,
  formatTimeUntilCompact,
  endTimeToGameYear,
  formatDateLocal,
} from "@/lib/utils/formatters";
import { STARTING_YEAR, MS_PER_TURN } from "@/lib/constants/turnTime";
import { formatRemainingTurns as formatRemainingTurnsLabel } from "@/lib/time/formatRemainingTurns";
import type { GameClock } from "@/lib/time/gameClock.server";

const DISPLAY_TICK_MS = 60_000;

// One shared minute ticker for every mounted clock consumer. Election/bill
// card lists previously installed one setInterval per card; now a single timer
// runs while at least one subscriber is mounted, and all consumers re-render
// in the same aligned wave.
let displayTick = 0;
const tickListeners = new Set<() => void>();
let tickTimer: ReturnType<typeof setInterval> | null = null;

function subscribeDisplayTick(listener: () => void): () => void {
  tickListeners.add(listener);
  if (!tickTimer) {
    tickTimer = setInterval(() => {
      displayTick++;
      tickListeners.forEach((l) => l());
    }, DISPLAY_TICK_MS);
  }
  return () => {
    tickListeners.delete(listener);
    if (tickListeners.size === 0 && tickTimer) {
      clearInterval(tickTimer);
      tickTimer = null;
    }
  };
}

const getDisplayTick = () => displayTick;
const getServerDisplayTick = () => 0;

/**
 * Build a client-side GameClock from the shared useGameTurnStatus snapshot.
 *
 * Re-renders on turn-completion events (via the upstream polling/event hook)
 * and every 60s for the drift readout. `clock.now` itself only changes when
 * `lastTurnProcessed` updates — game-clock countdowns are intentionally
 * discrete so a frozen cron produces a visibly frozen display.
 *
 * For RSC pages, use `getGameClock()` from `src/lib/time/gameClock.server.ts`.
 */
export function useGameClock(): GameClock {
  const status = useGameTurnStatus();

  // 60s tick to refresh realNow-derived values (drift readout, banner state).
  // clock.now itself does not change between turn-completion events.
  useSyncExternalStore(subscribeDisplayTick, getDisplayTick, getServerDisplayTick);

  const realNow = new Date();

  if (!status || !status.lastTurnProcessed) {
    return {
      now: realNow,
      realNow,
      lastTurnProcessed: new Date(0),
      pausedAt: null,
      pauseReason: null,
      pauseKind: null,
      currentTurn: 0,
      driftMs: 0,
      driftHours: 0,
      isPaused: false,
      isActive: false,
      formatRemaining: () => ({ text: "No timer", urgency: "normal" }),
      formatCompact: () => "—",
      formatYear: () => null,
      formatRemainingTurns: () => ({ text: "No timer", urgency: "normal" }),
      projectTurnToDate: () => null,
      toAbsoluteWallClock: (deadline) => {
        if (!deadline) return null;
        const d = new Date(deadline).getTime();
        return Number.isNaN(d) ? null : new Date(d);
      },
      formatAbsoluteDeadline: (deadline) => {
        if (!deadline) return "—";
        const d = new Date(deadline).getTime();
        return Number.isNaN(d) ? "—" : formatDateLocal(new Date(d));
      },
    };
  }

  const lastTurnProcessed = new Date(status.lastTurnProcessed);
  const pausedAt = status.pausedAt ? new Date(status.pausedAt) : null;
  const now = pausedAt ?? lastTurnProcessed;
  const driftMs = Math.max(0, realNow.getTime() - lastTurnProcessed.getTime());

  const toAbsoluteWallClockImpl = (deadline: Date | string | null | undefined): Date | null => {
    if (!deadline) return null;
    const d = new Date(deadline).getTime();
    if (Number.isNaN(d)) return null;
    return new Date(d + driftMs);
  };

  return {
    now,
    realNow,
    lastTurnProcessed,
    pausedAt,
    pauseReason: status.pauseReason ?? null,
    pauseKind: status.pauseKind ?? null,
    currentTurn: status.currentTurn,
    driftMs,
    driftHours: driftMs / 3_600_000,
    isPaused: pausedAt !== null,
    isActive: status.isActive,

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
      return endTimeToGameYear(
        timestamp,
        status.currentTurn,
        lastTurnProcessed,
        status.startingYear ?? STARTING_YEAR
      );
    },

    formatRemainingTurns(targetTurn) {
      return formatRemainingTurnsLabel(targetTurn, status.currentTurn);
    },
    projectTurnToDate(targetTurn) {
      if (targetTurn == null) return null;
      return new Date(realNow.getTime() + (targetTurn - status.currentTurn) * MS_PER_TURN);
    },

    toAbsoluteWallClock: toAbsoluteWallClockImpl,
    formatAbsoluteDeadline(deadline) {
      const shifted = toAbsoluteWallClockImpl(deadline);
      if (shifted == null) return "—";
      return formatDateLocal(shifted);
    },
  };
}
