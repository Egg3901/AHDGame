import type { ClientSession } from "mongodb";
import { assertTransactionSupportAtBoot } from "@/lib/db/transactionSupport";

/**
 * Mongo error code 117 (`ConflictingOperationInProgress`). Despite the
 * sharded-cluster wording, it fires on replica sets too: the driver hands out a
 * pooled session whose internal transaction counter is ahead of the server's
 * active transaction number (typically a session that survived a failed or
 * aborted transaction). Retrying the transaction on a FRESH session succeeds,
 * so this failure is transient, but it carries no
 * `TransientTransactionError` label, so `withTransaction`'s built-in retry
 * never runs and the error surfaces to players as an opaque 500.
 *
 * NOT every 117 is transient. The same code and the same message also fire when
 * OUR code issues concurrent operations on ONE session (a `Promise.all` of
 * session-bound reads): each racer sends `startTransaction` at the same
 * txnNumber and every loser is rejected. That variant is a call-pattern bug and
 * retrying cannot clear it, because each attempt re-runs the race. Ticket #1239
 * was this. Before assuming a stale session, check the call site for concurrent
 * session use.
 */
const MONGO_CONFLICTING_OPERATION_IN_PROGRESS = 117;

const DEFAULT_MAX_ATTEMPTS = 4;
const RETRY_BASE_DELAY_MS = 50;

export interface RunTransactionOptions {
  maxAttempts?: number;
  sleep?: (ms: number) => Promise<void>;
  onRetry?: (attempt: number, error: unknown) => void;
  /** Called once when the body is run WITHOUT a transaction (standalone Mongo). */
  onNonAtomic?: () => void;
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
 *
 * STANDALONE FALLBACK. Production Mongo has no replica set, so `withTransaction`
 * fails outright (code 20/263) rather than transiently. Retrying that on a fresh
 * session is futile and turns every call into an opaque 500 for the player: the
 * exact failure ticket #1239 reported on attack-sector. So the deployment is
 * probed FIRST, and when it cannot do transactions the body runs with NO
 * session; callers must treat that as non-atomic (`run` receives `undefined`)
 * and compensate for a partial write themselves. Every write in the callers'
 * bodies is already an optimistic compare-and-set that rejects on
 * `modifiedCount !== 1`, so the sequential path stays correct under concurrency.
 * It just is not atomic. This is the same trade `runWithOptionalTransaction`
 * already makes for money flow.
 *
 * The probe is the ONLY thing that selects the sequential path. A transaction
 * that fails once started is never re-run here, because `withTransaction` can
 * fail at commit with the body's writes already applied, and retrying that
 * sequentially would double-apply them.
 */
export async function runTransactionWithSessionRetry<T>(
  getMongoClient: () => Promise<{ startSession: () => ClientSession }>,
  run: (session?: ClientSession) => Promise<T>,
  options: RunTransactionOptions = {}
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const sleep = options.sleep ?? defaultSleep;

  let transactionsSupported = true;
  try {
    transactionsSupported = await assertTransactionSupportAtBoot();
  } catch {
    // The topology probe itself is unavailable, so preserve the previous
    // behaviour and attempt the transaction.
    transactionsSupported = true;
  }
  // Deliberately OUTSIDE the probe's try: an error raised by the body must
  // propagate to the caller, not get swallowed and re-run as a transaction.
  if (!transactionsSupported) {
    options.onNonAtomic?.();
    return run(undefined);
  }

  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const client = await getMongoClient();
    const session = client.startSession();
    try {
      return await session.withTransaction(() => run(session));
    } catch (error) {
      lastError = error;
      // Deliberately NOT retried sequentially. `withTransaction` may fail at
      // COMMIT, after the body has already written, so re-running it here could
      // double-apply every write. The upfront probe is what decides the
      // sequential path; by this point the only safe move is to surface it.
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
