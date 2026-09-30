import type { ClientSession, MongoServerError } from "mongodb";
import { getMongoClient } from "@/lib/mongodb";
import { assertTransactionSupportAtBoot } from "@/lib/db/transactionSupport";
import { runTransactionWithSessionRetry } from "@/lib/db/transactionWithRetry";
import * as Sentry from "@sentry/nextjs";

let warnedNonAtomicFallback = false;

/**
 * Run a unit of work inside a Mongo transaction when replica-set support is
 * available, and fall back to the provided sequential implementation on
 * standalone dev mongods that reject sessions/transactions.
 *
 * Topology is detected with the server's hello response, not URI query options.
 * A replica set can accept transactions through a direct connection without a
 * replicaSet query parameter. Standalone deployments use the supplied fallback;
 * callers remain responsible for partial-write safety on that path.
 *
 * Production topology is deployment state. Verify it with the boot probe and a
 * transaction against the target deployment instead of inferring it from this
 * helper or from the connection string.
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
