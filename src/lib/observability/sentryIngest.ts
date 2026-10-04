/**
 * Pure helpers describing where error events are sent. No env, clock or I/O:
 * callers pass the environment in, so every branch is unit-testable.
 */

/** Sentry SaaS organization slug that owns the game's error project. */
export const SENTRY_DEFAULT_ORG = "ahousedivided";
export const SENTRY_DEFAULT_PROJECT = "a-house-divided";

type IngestEnv = Record<string, string | undefined>;

/**
 * DSN the browser bundle is built with. The browser only sees NEXT_PUBLIC_*
 * values inlined at build time, so a deployment that sets only SENTRY_DSN
 * would otherwise report server errors and silently drop every client error.
 * A DSN carries a public ingest key by design, so reusing it is safe.
 */
export function resolvePublicSentryDsn(env: IngestEnv): string | undefined {
  return env.NEXT_PUBLIC_SENTRY_DSN?.trim() || env.SENTRY_DSN?.trim() || undefined;
}

export interface SentryIngestStatus {
  enabled: boolean;
  /** Ingest host only (never the key), or null when no usable DSN is set. */
  host: string | null;
  projectId: string | null;
  problem: "missing-dsn" | "invalid-dsn" | "disabled-environment" | null;
}

/** Summarize server-side ingestion without exposing the DSN key. */
export function describeSentryIngest(env: IngestEnv): SentryIngestStatus {
  const railwayEnv = env.RAILWAY_ENVIRONMENT_NAME || env.RAILWAY_SERVICE_NAME;
  const dsn = env.SENTRY_DSN?.trim();
  if (!railwayEnv) {
    return { enabled: false, host: null, projectId: null, problem: "disabled-environment" };
  }
  if (!dsn) return { enabled: false, host: null, projectId: null, problem: "missing-dsn" };
  try {
    const url = new URL(dsn);
    const projectId = url.pathname.split("/").filter(Boolean).pop() ?? "";
    if (!url.username || !projectId) throw new Error("incomplete dsn");
    return { enabled: true, host: url.host, projectId, problem: null };
  } catch {
    return { enabled: false, host: null, projectId: null, problem: "invalid-dsn" };
  }
}

export function formatSentryIngestLog(status: SentryIngestStatus): string {
  if (status.enabled) {
    return `[sentry] server ingestion enabled host=${status.host} project=${status.projectId}`;
  }
  return `[sentry] server ingestion DISABLED reason=${status.problem}`;
}
