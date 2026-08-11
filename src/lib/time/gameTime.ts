import { getDb } from "@/lib/mongodb";
import type { GameState, TurnLog } from "@/lib/db/types";
import { STARTING_YEAR, TURNS_PER_YEAR } from "@/lib/constants/turnTime";
import { calendarTurn } from "@/lib/utils/gameDate";

export interface GameTimeContext {
  currentTurn: number;
  lastTurnProcessed: Date;
  isActive: boolean;
  pausedAt: Date | null;
  /** The effective "now" for game calculations */
  effectiveNow: Date;
  /**
   * Calendar year of turn 1 for the active reset preset (1991, 2019, …).
   * Falls back to the global STARTING_YEAR constant for legacy rows that
   * pre-date the `startingYear` field.
   */
  startingYear: number;
  /**
   * Pinned display calendar year — honors the pre-iteration date freeze (stays
   * at the era start while a founding phase is active). Prefer this over
   * recomputing `startingYear + floor((currentTurn-1)/48)` for any DATE display,
   * so secondary screens don't drift ahead during the founding phase. Always
   * populated by `getGameTime`; optional so other literal constructors of this
   * shape (tests, internal clock helpers) needn't supply it.
   */
  currentYear?: number;
  /**
   * Pre-iteration calendar offset (`GameState.preIterationTurns`). 0 on normal
   * worlds. `calendarTurn(currentTurn, { preIterationTurns })` yields the pinned
   * display turn for week/month rendering. Always populated by `getGameTime`.
   */
  preIterationTurns?: number;
}

let cachedGameTime: GameTimeContext | null = null;
let cacheExpiry: number = 0;
const CACHE_TTL_MS = 5000; // 5 second cache

function createTurnLogRepairFilter(gameState: GameState): Record<string, unknown> {
  const filter: Record<string, unknown> = { success: true };

  // Resets are expected to bump GameState.iteration. Restricting the repair scan
  // to the current iteration prevents a fresh world from "healing" itself from
  // retained TTL logs that belong to an older run with higher turn numbers.
  if (gameState.iteration) {
    filter["iteration.type"] = gameState.iteration.type;
    filter["iteration.number"] = gameState.iteration.number;
    return filter;
  }

  // Pre-iteration worlds only trust pre-iteration logs. Mixing in iteration-tagged
  // logs would let a partially reset singleton fast-forward itself across eras.
  filter.$or = [{ iteration: { $exists: false } }, { iteration: null }];
  return filter;
}

export async function reconcileGameStateClock(
  gameState: GameState
): Promise<Pick<GameTimeContext, "currentTurn" | "lastTurnProcessed"> & { currentYear: number }> {
  const db = await getDb();
  const turnLogCollection = db.collection<TurnLog>("turnLogs") as {
    find: (filter: Record<string, unknown>) => unknown;
  };
  const turnLogCursor = turnLogCollection.find(createTurnLogRepairFilter(gameState)) as {
    sort?: (value: Record<string, number>) => unknown;
    limit?: (value: number) => unknown;
    toArray?: () => Promise<TurnLog[]>;
  };
  const sortedCursor =
    typeof turnLogCursor.sort === "function"
      ? (turnLogCursor.sort({ turn: -1, gameTime: -1 }) as typeof turnLogCursor)
      : turnLogCursor;
  const limitedCursor =
    typeof sortedCursor.limit === "function"
      ? (sortedCursor.limit(1) as typeof sortedCursor)
      : sortedCursor;
  const latestSuccessfulTurnLog = await (
    typeof limitedCursor.toArray === "function" ? limitedCursor.toArray() : Promise.resolve([])
  ).then((logs) => logs[0] ?? null);

  const repairedTurn = Math.max(gameState.currentTurn, latestSuccessfulTurnLog?.turn ?? 0);
  // Prefer the per-game `startingYear` stored at reset time (which honors the
  // preset's era — 1991, 2019, etc.). Fall back to the global constant for
  // legacy rows that pre-date the `startingYear` field.
  const startingYear = gameState.startingYear ?? STARTING_YEAR;
  // Honor the pre-iteration clock so the repair loop computes the SAME pinned
  // year the turn engine wrote (else `needsRepair` would fire every cache miss
  // and un-pin the date). Identity on normal worlds.
  const repairedCalendarTurn = calendarTurn(repairedTurn, {
    preIterationActive: gameState.preIteration?.active,
    preIterationTurns: gameState.preIterationTurns,
  });
  const repairedYear = startingYear + Math.floor((repairedCalendarTurn - 1) / TURNS_PER_YEAR);
  const repairedLastTurnProcessed = new Date(
    Math.max(
      new Date(gameState.lastTurnProcessed).getTime(),
      latestSuccessfulTurnLog?.gameTime?.getTime() ?? 0
    )
  );

  const needsRepair =
    repairedTurn !== gameState.currentTurn ||
    repairedYear !== gameState.currentYear ||
    repairedLastTurnProcessed.getTime() !== new Date(gameState.lastTurnProcessed).getTime();

  if (needsRepair) {
    const gameStateCollection = db.collection<GameState>("gameState") as {
      updateOne?: (
        filter: Record<string, unknown>,
        update: Record<string, unknown>
      ) => Promise<unknown>;
    };

    if (typeof gameStateCollection.updateOne === "function") {
      await gameStateCollection.updateOne(
        { _id: "current" },
        {
          $set: {
            currentTurn: repairedTurn,
            currentYear: repairedYear,
            lastTurnProcessed: repairedLastTurnProcessed,
            updatedAt: new Date(),
          },
        }
      );
    }
  }

  return {
    currentTurn: repairedTurn,
    currentYear: repairedYear,
    lastTurnProcessed: repairedLastTurnProcessed,
  };
}

export async function getGameTime(): Promise<GameTimeContext> {
  const now = Date.now();
  if (cachedGameTime && now < cacheExpiry) {
    return cachedGameTime;
  }

  const db = await getDb();
  const gameState = await db.collection<GameState>("gameState").findOne({ _id: "current" });

  if (!gameState) {
    throw new Error("GameState not found");
  }

  const repairedClock = await reconcileGameStateClock(gameState);

  // Use lastTurnProcessed as the LARP clock reference.
  // Election timestamps (endTime, startTime, primaryEndTime) are all anchored
  // to lastTurnProcessed, so comparisons must use the same reference.
  // During normal hourly cron play lastTurnProcessed ≈ real time; after batch
  // turns they diverge significantly — real time would give wrong phase results.
  const effectiveNow = gameState.pausedAt
    ? new Date(gameState.pausedAt)
    : new Date(repairedClock.lastTurnProcessed);

  const ctx: GameTimeContext = {
    currentTurn: repairedClock.currentTurn,
    lastTurnProcessed: new Date(repairedClock.lastTurnProcessed),
    isActive: gameState.isActive,
    pausedAt: gameState.pausedAt ? new Date(gameState.pausedAt) : null,
    effectiveNow,
    startingYear: gameState.startingYear ?? STARTING_YEAR,
    // Offset-aware pinned year (from reconcileGameStateClock) + the raw offset,
    // so date-display consumers honor the pre-iteration freeze without recomputing.
    currentYear: repairedClock.currentYear,
    preIterationTurns: gameState.preIterationTurns ?? 0,
  };

  cachedGameTime = ctx;
  cacheExpiry = now + CACHE_TTL_MS;

  return ctx;
}

export function invalidateGameTimeCache(): void {
  cachedGameTime = null;
  cacheExpiry = 0;
}

/** Helper: check if a timestamp has passed relative to game time */
export function hasGameTimePassed(timestamp: Date | string, gameTime: GameTimeContext): boolean {
  const ts = typeof timestamp === "string" ? new Date(timestamp) : timestamp;
  // Use >= so that a timestamp exactly equal to effectiveNow is treated as passed.
  // Elections start at startTime === lastTurnProcessed; strict > would leave them "upcoming".
  return gameTime.effectiveNow.getTime() >= ts.getTime();
}
