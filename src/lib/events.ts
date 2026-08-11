/**
 * Lightweight in-process event emitter for server-sent events (SSE).
 *
 * This works within a single Vercel serverless instance. Multiple instances
 * won't share state, but each client reconnects automatically via EventSource,
 * so they'll pick up changes on the next turn regardless. For production
 * scaling, this can be swapped for Redis pub/sub.
 */

type Listener = (event: GameEvent) => void;

export interface GameEvent {
  type: "turn_start" | "turn_complete" | "election_resolved" | "bill_enacted" | "theme_changed";
  payload: Record<string, unknown>;
  timestamp: string;
  /** Optional: the user ID associated with the event. */
  userId?: string;
}

const listeners = new Set<Listener>();

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function emit(event: GameEvent): void {
  for (const listener of listeners) {
    try {
      listener(event);
    } catch {
      // Don't let a broken listener crash the emitter
    }
  }
}

/**
 * Type guard for GameEvent. Use when receiving events from untrusted sources
 * (e.g., SSE message parsing in the desktop client integration layer).
 */
export function validateSSEEvent(event: unknown): event is GameEvent {
  return (
    typeof event === "object" &&
    event !== null &&
    "type" in event &&
    typeof (event as GameEvent).type === "string" &&
    "payload" in event &&
    "timestamp" in event
  );
}
