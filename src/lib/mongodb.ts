import { MongoClient, Db } from "mongodb";
import { getValidatedEnv } from "@/lib/env";
import { attachMongoCommandMonitor } from "@/lib/observability/mongoMonitor";

declare global {
  var _mongoClientPromise: Promise<MongoClient> | undefined;
}

export const DEFAULT_MONGODB_DB_NAME = "a-house-divided";

type MongoDbNameEnv = {
  MONGODB_URI?: string;
  MONGO_URL?: string;
  MONGODB_DB?: string;
  MONGO_DB_NAME?: string;
};

export function extractMongoDbNameFromUri(uri: string | undefined): string | undefined {
  if (!uri) return undefined;

  const match = uri.match(/^mongodb(?:\+srv)?:\/\/(?:[^/]+@)?[^/]+\/([^?/]*)/i);
  const dbName = match?.[1]?.trim();
  if (!dbName) return undefined;

  return decodeURIComponent(dbName);
}

export function resolveMongoDbName(env: MongoDbNameEnv): string {
  const explicitDbName = env.MONGODB_DB?.trim() || env.MONGO_DB_NAME?.trim();
  if (explicitDbName) return explicitDbName;

  return extractMongoDbNameFromUri(env.MONGODB_URI || env.MONGO_URL) ?? DEFAULT_MONGODB_DB_NAME;
}

function getClientPromise(): Promise<MongoClient> {
  const uri =
    process.env.NODE_ENV === "test" ? process.env.MONGODB_URI : getValidatedEnv().MONGODB_URI;
  if (!uri) {
    throw new Error(
      "MONGODB_URI is not set. Add it to .env.local for local development or your deployment environment variables."
    );
  }

  // Reuse a single client across invocations in all environments to avoid
  // exhausting connection pool limits on Vercel serverless functions.
  if (!global._mongoClientPromise) {
    // If connect() rejects once, we must not cache that rejection forever — the same
    // worker would then throw on every subsequent getDb() until cold restart (refresh
    // often gets a fresh isolate, which masked the bug as "first load 500, retry OK").
    const client = new MongoClient(uri, {
      maxPoolSize: 15, // Raised from 5 — a single page load fires 7+ parallel auth requests
      minPoolSize: 5, // Keep warm connections alive for Railway proxy (prevents ECONNRESET)
      maxIdleTimeMS: 0, // Never idle-timeout pooled connections; proxy handles its own lifecycle
      serverSelectionTimeoutMS: 10_000, // Fail fast in serverless rather than blocking for 30 s
      socketTimeoutMS: 60_000, // Prevent individual operations from hanging indefinitely
      monitorCommands: process.env.NODE_ENV !== "test", // emit command events for observability
    });
    // Instrument every query (breadcrumbs + slow-query/failure capture) centrally.
    attachMongoCommandMonitor(client);
    global._mongoClientPromise = client.connect().catch((err) => {
      global._mongoClientPromise = undefined;
      throw err;
    });
  }
  return global._mongoClientPromise;
}

export async function getDb(): Promise<Db> {
  const dbName =
    process.env.NODE_ENV === "test"
      ? resolveMongoDbName(process.env as MongoDbNameEnv)
      : resolveMongoDbName(getValidatedEnv());

  try {
    const client = await getClientPromise();
    return client.db(dbName);
  } catch {
    // One immediate retry after clearing stale state (transient Atlas / cold connect).
    global._mongoClientPromise = undefined;
    const client = await getClientPromise();
    return client.db(dbName);
  }
}

/**
 * Return the pooled `MongoClient` when the caller needs to open a session /
 * transaction. Most routes only need `getDb()`; reach for this helper when
 * multiple cross-collection writes must commit atomically (e.g. corp HQ
 * relocation's currency conversion touching `corporations` + `corporateSectors`).
 *
 * Transactions require a replica set. Production (Atlas) always runs one;
 * standalone dev mongods do not — callers should handle the
 * `TransactionNotSupported` (code 20) MongoServerError gracefully (fall back
 * to sequential writes or surface as an unrecoverable error depending on the
 * correctness requirement).
 */
export async function getMongoClient(): Promise<MongoClient> {
  return getClientPromise();
}

/** Re-export for convenience; same as mongodb.Db. */
export type { Db };

export default getClientPromise;
