"use client";

import type { ReactNode } from "react";
import { useGameTurnStatus } from "@/hooks/useGameEvents";
import { STARTING_YEAR } from "@/lib/constants/turnTime";
import { formatGameMonth } from "@/lib/utils/gameDate";

/**
 * Display a persisted wall-clock event on the in-game calendar.
 *
 * Use for PAST in-game events (bill introduced, coalition joined, poll taken).
 * Future deadlines stay on the wall clock: players act on them in real time,
 * and the game-month mapping clamps anything after the last processed turn.
 */
export function GameMonthTime({
  value,
  className,
  fallback = null,
}: {
  value: string | Date;
  className?: string;
  /** Rendered until the turn status loads (or when the world has no clock yet). */
  fallback?: ReactNode;
}) {
  const status = useGameTurnStatus();
  const date = typeof value === "string" ? new Date(value) : value;
  if (!status?.lastTurnProcessed || Number.isNaN(date.getTime())) return <>{fallback}</>;

  const month = formatGameMonth(date, {
    currentTurn: status.currentTurn,
    lastTurnProcessed: status.lastTurnProcessed,
    startingYear: status.startingYear ?? STARTING_YEAR,
    preIterationActive: status.preIterationActive,
    preIterationTurns: status.preIterationTurns,
  });

  return (
    <time dateTime={date.toISOString()} className={className}>
      {month}
    </time>
  );
}
