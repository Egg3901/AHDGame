"use client";

import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";

export interface GameEvent {
  type: "turn_start" | "turn_complete" | "election_resolved" | "bill_enacted";
  payload: Record<string, unknown>;
  timestamp: string;
}

export interface TurnStatus {
  currentTurn: number;
  currentYear?: number;
  /**
   * Calendar year of turn 1 for the active reset preset. Surfaced via
   * `/api/game/turn/status` so client-side LARP-date helpers
   * (`turnToLarpDate`, `endTimeToGameYear`) honor 1991 vs 2019 presets.
   */
  startingYear?: number;
  /** Reset-preset id (e.g. `"1991-default"`). */
  preset?: string;
  /** Founding (pre-iteration) phase is running — the calendar is pinned to the era start. */
  preIterationActive?: boolean;
  /** Turns the founding phase consumed, subtracted from the calendar once it ends. */
  preIterationTurns?: number;
  isActive: boolean;
  isProcessing: boolean;
  nextScheduledTurn: string | null;
  lastTurnProcessed?: string;
  pausedAt?: string | null;
  pauseReason?: string | null;
  pauseKind?: "manual" | "auto-drift" | null;
  corporationActionsPaused?: boolean;
  playerTransfersPaused?: boolean;
  freePartyMovesOpen?: boolean;
  playerRandomEventsEnabled?: boolean;
  fastMode?: boolean;
  /** True once the processing lock has exceeded its stale window. */
  canResetProcessingLock?: boolean;
  processingLockStaleAt?: string | null;
  processingTargetTurn?: number | null;
}

type EventHandler = (event: GameEvent) => void;
type StatusListener = () => void;
type GameEventListener = (event: GameEvent) => void;

const ALL_TYPES: GameEvent["type"][] = [
  "turn_start",
  "turn_complete",
  "election_resolved",
  "bill_enacted",
];

let statusSnapshot: TurnStatus | null = null;
let prevTurn: number | null = null;
let pollTimer: ReturnType<typeof setTimeout> | null = null;
let pollInFlight: Promise<void> | null = null;
let lastPollAt = 0;
let visibilityListenerRegistered = false;

const statusListeners = new Set<StatusListener>();
const eventListeners = new Set<GameEventListener>();

/**
 * Pure helper: given the previously seen turn number and the latest status,
 * returns which game event types should be fired.
 *
 * Uses the DB-backed isProcessing flag (set by turnSystem.ts) to detect
 * turn_start, avoiding the unreliable nextScheduledTurn comparison.
 *
 * Exported for unit testing.
 */
export function detectTurnEvents(
  prevTurnValue: number | null,
  status: Pick<TurnStatus, "currentTurn" | "isActive" | "isProcessing">
): ("turn_start" | "turn_complete")[] {
  if (prevTurnValue === null) return [];
  if (status.isActive && status.currentTurn > prevTurnValue) return ["turn_complete"];
  if (status.isActive && status.isProcessing && status.currentTurn === prevTurnValue)
    return ["turn_start"];
  return [];
}

function hasSubscribers() {
  return statusListeners.size > 0 || eventListeners.size > 0;
}

function clearScheduledPoll() {
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
}

function resetSharedPoller() {
  clearScheduledPoll();
  statusSnapshot = null;
  prevTurn = null;
  pollInFlight = null;
  lastPollAt = 0;
}

function notifyStatusListeners() {
  for (const listener of statusListeners) {
    listener();
  }
}

function emitGameEvent(event: GameEvent) {
  for (const listener of eventListeners) {
    try {
      listener(event);
    } catch (error) {
      console.error("Game event listener failed:", error);
    }
  }
}

function nextPollDelay(status: TurnStatus, now: Date): number {
  if (typeof document !== "undefined" && document.visibilityState !== "visible") {
    return 300_000;
  }
  if (!status.nextScheduledTurn || !status.isActive) return 120_000;
  const diff = new Date(status.nextScheduledTurn).getTime() - now.getTime();
  if (diff < 120_000) return 15_000; // Align near-turn polling with the API's browser cache window
  if (diff < 600_000) return 60_000; // Normal within 10 min
  return 120_000; // Relaxed when far from turn
}

function scheduleNextPoll(ms: number) {
  clearScheduledPoll();
  if (!hasSubscribers()) return;
  pollTimer = setTimeout(() => {
    void pollTurnStatus();
  }, ms);
}

async function pollTurnStatus() {
  if (!hasSubscribers()) {
    clearScheduledPoll();
    return;
  }

  if (pollInFlight) {
    await pollInFlight;
    return;
  }

  pollInFlight = (async () => {
    try {
      const res = await fetch("/api/game/turn/status", {
        signal: AbortSignal.timeout(8_000),
      });

      if (res.ok) {
        const status: TurnStatus = await res.json();
        const now = new Date();
        const events = detectTurnEvents(prevTurn, status);

        prevTurn = status.currentTurn;
        statusSnapshot = status;
        notifyStatusListeners();

        for (const eventType of events) {
          emitGameEvent({
            type: eventType,
            payload: {},
            timestamp: now.toISOString(),
          });
        }

        scheduleNextPoll(nextPollDelay(status, now));
      } else {
        scheduleNextPoll(30_000);
      }
    } catch {
      scheduleNextPoll(30_000);
    } finally {
      lastPollAt = Date.now();
      pollInFlight = null;
    }
  })();

  await pollInFlight;
}

function handleVisibilityChange() {
  if (typeof document === "undefined") return;

  if (document.visibilityState === "visible") {
    if (hasSubscribers() && Date.now() - lastPollAt > 5_000) {
      void pollTurnStatus();
    }
    return;
  }

  clearScheduledPoll();
  if (statusSnapshot && hasSubscribers()) {
    scheduleNextPoll(nextPollDelay(statusSnapshot, new Date()));
  }
}

function ensureVisibilityListener() {
  if (visibilityListenerRegistered || typeof document === "undefined") return;
  document.addEventListener("visibilitychange", handleVisibilityChange);
  visibilityListenerRegistered = true;
}

function ensurePolling() {
  if (!hasSubscribers()) return;
  ensureVisibilityListener();

  if (!pollTimer && !pollInFlight) {
    void pollTurnStatus();
  }
}

function subscribeToTurnStatus(listener: StatusListener) {
  statusListeners.add(listener);
  ensurePolling();

  return () => {
    statusListeners.delete(listener);
    if (!hasSubscribers()) {
      resetSharedPoller();
    }
  };
}

function subscribeToGameEvents(listener: GameEventListener) {
  eventListeners.add(listener);
  ensurePolling();

  return () => {
    eventListeners.delete(listener);
    if (!hasSubscribers()) {
      resetSharedPoller();
    }
  };
}

function subscribeNoop() {
  return () => {};
}

function getTurnStatusSnapshot() {
  return statusSnapshot;
}

function getNullSnapshot() {
  return null;
}

export function useGameTurnStatus(enabled = true) {
  return useSyncExternalStore(
    enabled ? subscribeToTurnStatus : subscribeNoop,
    enabled ? getTurnStatusSnapshot : getNullSnapshot,
    getNullSnapshot
  );
}

/**
 * Subscribe to game turn events via a shared polling loop. All consumers on the
 * page reuse the same `/api/game/turn/status` requests to avoid multiplying
 * traffic from separate components.
 *
 * @param onEvent - callback invoked for matching game events
 * @param eventTypes - optional filter; only fire for these event types
 * @param enabled - set false to disable polling (e.g. on excluded pages)
 */
export function useGameEvents(
  onEvent: EventHandler,
  eventTypes?: GameEvent["type"][],
  enabled = true
) {
  const handlerRef = useRef(onEvent);
  useEffect(() => {
    handlerRef.current = onEvent;
  }, [onEvent]);

  const typesRef = useRef(eventTypes);
  useEffect(() => {
    typesRef.current = eventTypes;
  }, [eventTypes]);

  useEffect(() => {
    if (!enabled) return;

    return subscribeToGameEvents((event) => {
      const types = typesRef.current ?? ALL_TYPES;
      if (types.includes(event.type)) {
        handlerRef.current(event);
      }
    });
  }, [enabled]);
}

/**
 * Convenience hook: reload the page when a turn completes.
 * Use on pages that show turn-dependent data.
 */
export function useLiveRefresh(enabled = true) {
  useGameEvents(
    useCallback(() => {
      window.location.reload();
    }, []),
    ["turn_complete"],
    enabled
  );
}
