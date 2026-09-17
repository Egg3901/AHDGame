import type { ClientSession, MongoServerError } from "mongodb";
import { getMongoClient } from "@/lib/mongodb";
import { assertTransactionSupportAtBoot } from "@/lib/db/transactionSupport";
import { runTransactionWithSessionRetry } from "@/lib/db/transactionWithRetry";
import * as Sentry from "@sentry/nextjs";

let warnedNonAtomicFallback = false;

/**
 * Run a unit of work inside a Mongo transaction when replica-set support is
 * available, and fall back to the provided sequential implementation on
 * standalone mongods that reject sessions/transactions.
 *
 * NOTE: a standalone deployment (no replica set) makes `withTransaction`
 * throw (code 20/263), so money flow runs NON-ATOMIC there. The durable fix
 * is a maintenance-window migration to a single-node replica set (backup
 * first, restart with a replica-set name, initiate the set, point the
 * connection string at it, verify transactions succeed); until then the
 * fallback keeps writes working, just not atomic. Do NOT attempt the
 * migration live without a backup and a window.
 *
 * Callers moving money MUST NOT rely on this fallback being atomic (issue
 * #1672). New money flows should express their balance writes as keyed
 * idempotent legs via `src/lib/db/nonAtomicMoneyFlow.ts`, which reconciles
 * a crash between sequential writes to exactly one final state.
 */
export async function runWithOptionalTransaction<T>(
  runInTransaction: (session: ClientSession) => Promise<T>,
  runWithoutTransaction: () => Promise<T>
): Promise<T> {
  try {
    if (!(await assertTransactionSupportAtBoot())) {
      return runWithoutTransaction();
    }
  } catch {
    // Preserve the existing attempt-and-fallback behavior if the topology
    // probe itself is unavailable.
  }

  try {
    // Session lifecycle (and the retry on code 117, a poisoned pooled session)
    // is owned by the retry helper: each attempt runs on a fresh session. The
    // helper re-probes transaction support and hands the callback `undefined`
    // on standalone Mongo; route that to the caller's sequential fallback.
    return await runTransactionWithSessionRetry(getMongoClient, (session) =>
      session ? runInTransaction(session) : runWithoutTransaction()
    );
  } catch (error) {
    const code = (error as MongoServerError | undefined)?.code;
    if (code === 20 || code === 263) {
      if (!warnedNonAtomicFallback) {
        warnedNonAtomicFallback = true;
        if (process.env.NODE_ENV === "production") {
          Sentry.captureMessage(
            "Mongo transactions unsupported — money flow running without a transaction (non-atomic)",
            {
              level: "error",
              // Stable fingerprint so every replica/restart/call-site collapses
              // into ONE issue instead of fragmenting across dozens. This is a
              // persistent infra condition (standalone Mongo), not a per-event bug.
              fingerprint: ["mongo-non-atomic-fallback"],
              extra: { code },
            }
          );
        }
        console.warn(
          "[db] Mongo transactions unsupported; falling back to non-atomic sequential writes"
        );
      }
      return runWithoutTransaction();
    }
    throw error;
  }
}
