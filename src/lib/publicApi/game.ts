import type { Db } from "mongodb";
import { getGameState } from "@/lib/gameState";
import { STARTING_YEAR } from "@/lib/constants/turnTime";
import { calendarTurn } from "@/lib/utils/gameDate";
import { turnToLarpDate, turnToLarpParts } from "@/lib/utils/formatters";

const NORMAL_TURN_MS = 3_600_000;
const FAST_TURN_MS = 1_800_000;

export async function queryGameState(db: Db) {
  const state = await getGameState(db);
  if (!state) return null;

  const turnDurationMs = state.fastMode ? FAST_TURN_MS : NORMAL_TURN_MS;
  const startingYear = state.startingYear ?? STARTING_YEAR;
  const displayTurn = calendarTurn(state.currentTurn, {
    preIterationActive: state.preIteration?.active,
    preIterationTurns: state.preIterationTurns,
  });
  const calendar = turnToLarpParts(displayTurn, startingYear);
  const monthIndex = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ].indexOf(calendar.month);
  const gameDate = new Date(Date.UTC(calendar.year, monthIndex, (calendar.weekOfMonth - 1) * 7 + 1))
    .toISOString()
    .slice(0, 10);

  return {
    found: true,
    currentTurn: state.currentTurn,
    displayTurn,
    currentYear: calendar.year,
    startingYear,
    gameDate,
    gameDateLabel: turnToLarpDate(displayTurn, startingYear),
    calendar,
    nextTurnAt: state.nextScheduledTurn?.toISOString() ?? null,
    lastTurnAt: state.lastTurnProcessed?.toISOString() ?? null,
    turnDurationMs,
    status: state.isActive ? "active" : "paused",
    isActive: state.isActive,
    fastMode: state.fastMode ?? false,
    preset: state.preset ?? null,
    iteration: state.iteration ?? null,
  };
}
