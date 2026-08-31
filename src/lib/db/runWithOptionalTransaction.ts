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
 * TODO(infra): production Mongo (Railway "Main DB") is a STANDALONE instance —
 * its MONGODB_URI has no `?replicaSet`, so withTransaction below always throws
 * (code 20/263) and money flow runs NON-ATOMIC in prod (GlitchTip:
 * "mongo-non-atomic-fallback", ~40 events). The real fix is a one-time
 * maintenance-window migration to a single-node replica set:
 *   1. Take a fresh DB backup/snapshot.
 *   2. Run mongod with `--replSet rs0` (Railway: set the Main DB start command
 *      / use a replica-set-capable image).
 *   3. Connect once and `rs.initiate({_id:"rs0", members:[{_id:0, host:"<advertised host:port>"}]})`.
 *   4. Update MONGODB_URI on Main Site + Sandbox Staging to append
 *      `?replicaSet=rs0` (and `directConnection=true` if going through the TCP proxy).
 *   5. Verify `withTransaction` succeeds, then this fallback path goes cold.
 * Until then the fallback keeps writes working (just not atomic). Do NOT
 * attempt this live without a backup + window — it can cause downtime.
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
