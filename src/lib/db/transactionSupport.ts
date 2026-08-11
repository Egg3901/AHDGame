/**
 * Probes the MongoDB deployment to determine whether multi-document transactions
 * are supported. Logs a clear warning in production if they are not, and returns
 * `true` when supported.
 *
 * - Replica set: `setName` is a non-empty string → transactions supported.
 * - Sharded cluster (mongos): `msg === "isdbgrid"` → transactions supported.
 * - Standalone: neither → transactions NOT supported.
 *
 * If the probe itself throws, the error is re-thrown (caller is expected to
 * handle it gracefully).
 */
import { getMongoClient } from "@/lib/mongodb";
import * as Sentry from "@sentry/nextjs";

let transactionSupportPromise: Promise<boolean> | undefined;

async function probeTransactionSupport(): Promise<boolean> {
  const client = await getMongoClient();
  const hello: { setName?: string; msg?: string } = await client.db("admin").command({ hello: 1 });

  const isReplicaSet = typeof hello.setName === "string" && hello.setName.length > 0;
  const isSharded = hello.msg === "isdbgrid";
  const supported = isReplicaSet || isSharded;

  if (!supported) {
    const topology = "standalone";
    const message =
      "MongoDB deployment is a standalone instance. Multi-document transactions are NOT supported. " +
      "Money flows will run without atomicity guarantees. Deploy a replica set (or sharded cluster) in production.";

    if (process.env.NODE_ENV === "production") {
      Sentry.captureMessage(message, {
        level: "error",
        // One issue for the whole deployment, not one per booting replica.
        fingerprint: ["mongo-standalone-no-transactions"],
        extra: { topology },
      });
      console.error("[db]", message);
    } else {
      console.warn(
        "[db] (expected on local standalone dev) Transactions not supported –",
        topology
      );
    }
  }

  return supported;
}

export function assertTransactionSupportAtBoot(): Promise<boolean> {
  // Don't memoize a rejected probe — a transient failure (e.g. Mongo not yet
  // reachable at cold boot) would otherwise permanently pin every future
  // caller to the non-transactional fallback for the life of the process.
  transactionSupportPromise ??= probeTransactionSupport().catch((err) => {
    transactionSupportPromise = undefined;
    throw err;
  });
  return transactionSupportPromise;
}
