import type { ClientSession, MongoClient, TransactionOptions } from "mongodb";
import { ReadPreference } from "mongodb";
import { getMongoClient } from "@/lib/mongodb";

const DEFAULT_TRANSACTION_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_COMMIT_TIME_MS = 5_000;
const MAX_TRANSACTION_TIMEOUT_MS = 60_000;
const MAX_COMMIT_TIME_MS = 30_000;

export interface RequiredTransactionOptions {
  /** Use the application's already connected client when a caller has one. */
  client?: MongoClient;
  /** Driver-managed Mongo operation budget across transaction attempts. */
  timeoutMS?: number;
  /** Driver-managed deadline for commitTransaction. */
  maxCommitTimeMS?: number;
}

export type RequiredTransactionBody<T> = (session: ClientSession) => Promise<T>;

/**
 * The transaction committed, but ending the owned session failed. Callers can
 * safely reconcile `committedResult`; they must not treat this as an aborted
 * transaction or retry the callback with new writes.
 */
export class RequiredTransactionCleanupError<T = unknown> extends Error {
  readonly committedResult: T;
  readonly cause: unknown;

  constructor(committedResult: T, cause: unknown) {
    super("The required transaction committed, but session cleanup failed");
    this.name = "RequiredTransactionCleanupError";
    this.committedResult = committedResult;
    this.cause = cause;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

function boundedMilliseconds(
  value: number | undefined,
  defaultValue: number,
  maximum: number,
  name: string
): number {
  const result = value ?? defaultValue;
  if (!Number.isInteger(result) || result <= 0 || result > maximum) {
    throw new RangeError(`${name} must be an integer between 1 and ${maximum}`);
  }
  return result;
}

/**
 * Run required multi-document work on a primary replica-set transaction.
 *
 * The callback always receives the active session. Every Mongo operation in
 * the callback must pass that session and be awaited serially. The driver may
 * invoke the callback again for a transient transaction error, so callers
 * freeze IDs, timestamps, and external-effect plans before entering it. The
 * callback must contain database work only: network, email, queues, and other
 * external effects belong after a committed receipt can be reconciled. The
 * callback must not manually start, commit, or abort the transaction, and must
 * not catch and suppress database errors.
 *
 * This helper deliberately has no standalone fallback and no application
 * retry around `withTransaction`. The Mongo driver owns its documented
 * transient transaction and commit retry rules. In particular, an unknown
 * commit result is propagated without replaying the callback with new IDs.
 * `timeoutMS` and `maxCommitTimeMS` are driver options, so there is no
 * Promise.race that could leave callback work running after cleanup. These are
 * Mongo operation budgets, not a hard wall-clock limit for arbitrary CPU or
 * non-Mongo work inside the callback.
 *
 * The supplied client is never closed. If omitted, the application's pooled
 * client is used. The session created here is always ended, while a callback
 * or commit error remains the error observed by the caller even if cleanup
 * also fails. If the transaction committed and cleanup fails, the helper
 * throws `RequiredTransactionCleanupError` with the committed result and the
 * cleanup cause so callers can reconcile without retrying the writes.
 */
export async function runRequiredTransaction<T>(
  body: RequiredTransactionBody<T>,
  options: RequiredTransactionOptions = {}
): Promise<T> {
  if (typeof body !== "function") {
    throw new TypeError("runRequiredTransaction requires a transaction callback");
  }

  const timeoutMS = boundedMilliseconds(
    options.timeoutMS,
    DEFAULT_TRANSACTION_TIMEOUT_MS,
    MAX_TRANSACTION_TIMEOUT_MS,
    "timeoutMS"
  );
  const maxCommitTimeMS = boundedMilliseconds(
    options.maxCommitTimeMS,
    DEFAULT_MAX_COMMIT_TIME_MS,
    MAX_COMMIT_TIME_MS,
    "maxCommitTimeMS"
  );
  if (maxCommitTimeMS >= timeoutMS) {
    throw new RangeError("maxCommitTimeMS must be less than timeoutMS");
  }

  const client = options.client ?? (await getMongoClient());
  const session = client.startSession();
  const transactionOptions: TransactionOptions & { timeoutMS: number } = {
    readConcern: { level: "snapshot" },
    writeConcern: { w: "majority" },
    readPreference: ReadPreference.primary,
    maxCommitTimeMS,
    timeoutMS,
  };

  let result: T | undefined;
  let failed = false;
  let failure: unknown;

  try {
    result = await session.withTransaction(
      (activeSession) => body(activeSession),
      transactionOptions
    );
  } catch (error) {
    failed = true;
    failure = error;
  }

  try {
    await session.endSession();
  } catch (cleanupError) {
    if (!failed) {
      throw new RequiredTransactionCleanupError(result as T, cleanupError);
    }
  }

  if (failed) {
    throw failure;
  }
  return result as T;
}
