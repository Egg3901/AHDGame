import { getDb } from "@/lib/mongodb";
import { clientIpFromRequest } from "@/lib/utils/network";

/**
 * One row in the `apiAccessLog` collection. This is Phase-1 instrumentation:
 * we record who hit which endpoint and how often, so later phases can detect
 * enumeration / fixed-interval polling / scraping. It does NOT enforce anything.
 *
 * Rows are TTL-expired (see `seedApiAccessIndexes`), so retention is bounded.
 */
export interface ApiAccessLogEntry {
  /** URL pathname, e.g. "/api/public/v1/elections". */
  path: string;
  /** HTTP method. */
  method: string;
  /** Client IP (best-effort, from proxy headers). */
  ip: string;
  /** User-Agent header, if any. */
  userAgent: string | null;
  /** Rate-limit bucket the request was charged to, if known. */
  bucket?: string;
  /** Owning user id, when the request is attributable to an account. */
  userId?: string;
  /** API key id, when authenticated via an API key. */
  keyId?: string;
  /** "user-key" | "bot-token" | "synthetic" | … — how the caller authenticated. */
  authType?: string;
  /**
   * The playtest run a synthetic request belongs to.
   *
   * Recorded so a harness run's traffic can be separated from a person's after
   * the fact. Without it, automated activity is only distinguishable while the
   * character still exists.
   */
  syntheticRunId?: string;
  /** Response status, when known at log time. */
  status?: number;
  timestamp: Date;
}

/**
 * Fire-and-forget access log. Never awaited on the request path and never
 * throws — a logging failure must not affect the response. Mirrors the
 * background usage-stat update in `userApiAuth`.
 */
export function logApiAccess(
  request: Request,
  fields: Omit<ApiAccessLogEntry, "path" | "method" | "ip" | "userAgent" | "timestamp">
): void {
  let path = "";
  try {
    path = new URL(request.url).pathname;
  } catch {
    path = request.url;
  }
  const entry: ApiAccessLogEntry = {
    path,
    method: request.method,
    ip: clientIpFromRequest(request),
    userAgent: request.headers.get("user-agent"),
    ...fields,
    timestamp: new Date(),
  };

  void (async () => {
    try {
      const db = await getDb();
      await db.collection<ApiAccessLogEntry>("apiAccessLog").insertOne(entry);
    } catch {
      // Intentionally swallow: instrumentation must never break a request.
    }
  })();
}
