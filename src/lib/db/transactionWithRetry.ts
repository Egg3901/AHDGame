import type { ClientSession } from "mongodb";

/**
 * Mongo error code 117 (`ConflictingOperationInProgress`). Despite the
 * sharded-cluster wording, it fires on replica sets too: the driver hands out a
 * pooled session whose internal transaction counter is ahead of the server's
 * active transaction number (typically a session that survived a failed or
 * aborted transaction). Retrying the transaction on a FRESH session succeeds,
 * so this failure is transient — but it carries no
 * `TransientTransactionError` label, so `withTransaction`'s built-in retry
 * never runs and the error surfaces to players as an opaque 500.
 */
const MONGO_CONFLICTING_OPERATION_IN_PROGRESS = 117;

const DEFAULT_MAX_ATTEMPTS = 4;
const RETRY_BASE_DELAY_MS = 50;

export interface RunTransactionOptions {
  maxAttempts?: number;
  sleep?: (ms: number) => Promise<void>;
  onRetry?: (attempt: number, error: unknown) => void;
}

function isConflictingOperationInProgress(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  return (error as { code?: unknown }).code === MONGO_CONFLICTING_OPERATION_IN_PROGRESS;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Run `run(session)` inside a multi-document transaction, retrying
 * `ConflictingOperationInProgress` (code 117) failures with a brand-new
 * session each attempt. A failed session cannot be reused for this error —
 * only a fresh `startSession()` clears the poisoned transaction counter — so
 * every attempt opens and ends its own session.
 *
 * Mongo's built-in `withTransaction` retry does not cover this error (it lacks
 * the transient label), and callers like the sector-split route end up
 * surfacing raw `MongoServerError` 500s to players when the pooled session is
 * stale. All other errors propagate immediately. Every session is ended,
 * including on the failure path.
 */
export async function runTransactionWithSessionRetry<T>(
  getMongoClient: () => Promise<{ startSession: () => ClientSession }>,
  run: (session: ClientSession) => Promise<T>,
  options: RunTransactionOptions = {}
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const sleep = options.sleep ?? defaultSleep;

  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const client = await getMongoClient();
    const session = client.startSession();
    try {
      return await session.withTransaction(() => run(session));
    } catch (error) {
      lastError = error;
      if (!isConflictingOperationInProgress(error) || attempt === maxAttempts) {
        throw error;
      }
      options.onRetry?.(attempt, error);
      await sleep(RETRY_BASE_DELAY_MS * attempt);
    } finally {
      await session.endSession();
    }
  }
  throw lastError;
}
