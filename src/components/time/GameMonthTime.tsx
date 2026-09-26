"use client";

import { useGameTurnStatus } from "@/hooks/useGameEvents";
import { STARTING_YEAR } from "@/lib/constants/turnTime";
import { formatGameMonth } from "@/lib/utils/gameDate";

/** Display a persisted wall-clock event on the in-game calendar. */
export function GameMonthTime({ value, className }: { value: string; className?: string }) {
  const status = useGameTurnStatus();
  if (!status?.lastTurnProcessed) return null;

  const month = formatGameMonth(value, {
    currentTurn: status.currentTurn,
    lastTurnProcessed: status.lastTurnProcessed,
    startingYear: status.startingYear ?? STARTING_YEAR,
    preIterationActive: status.preIterationActive,
    preIterationTurns: status.preIterationTurns,
  });

  return (
    <time dateTime={value} className={className}>
      {month}
    </time>
  );
}
