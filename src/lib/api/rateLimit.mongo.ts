/**
 * MongoDB-backed rate limiting (durable L2).
 *
 * The in-memory limiter in `./rateLimit` is process-local: it resets on every
 * deploy and is not shared across replicas. For high-value buckets (auth,
 * API-key creation) that is not good enough — an attacker could reset their
 * window by waiting for a deploy, and horizontal scaling would multiply the
 * effective limit by the replica count.
 *
 * `durableRateLimit` is a hybrid: it checks the in-memory limiter first (a
 * zero-latency fast-reject that absorbs bursts) and only consults Mongo when
 * the local check passes. Mongo is the authoritative counter. If Mongo is
 * unavailable the call fails open to the local result, so a storage hiccup
 * never hard-blocks legitimate traffic.
 */
import { getDb } from "@/lib/mongodb";
import { checkRateLimit, type RateLimitResult } from "./rateLimit";

interface RateLimitBucket {
  _id: string;
  count: number;
  /** TTL field — the document self-deletes once the window has elapsed. */
  expiresAt: Date;
}

/**
 * Authoritative fixed-window counter backed by Mongo. One document per
 * `(identifier, window)` pair, incremented atomically. Throws if the DB is
 * unavailable — callers that want resilience should use {@link durableRateLimit}.
 */
export async function mongoRateLimit(
  identifier: string,
  maxRequests: number,
  windowMs: number
): Promise<RateLimitResult> {
  const id = identifier && identifier !== "unknown" ? identifier : "__unknown_ip__";
  const now = Date.now();
  const windowStart = Math.floor(now / windowMs) * windowMs;
  const resetAt = windowStart + windowMs;

  const db = await getDb();
  const doc = await db
    .collection<RateLimitBucket>("rateLimitBuckets")
    .findOneAndUpdate(
      { _id: `${id}:${windowStart}` },
      { $inc: { count: 1 }, $setOnInsert: { expiresAt: new Date(resetAt) } },
      { upsert: true, returnDocument: "after" }
    );

  const count = doc?.count ?? 1;
  if (count > maxRequests) {
    return {
      ok: false,
      limit: maxRequests,
      remaining: 0,
      resetAt,
      retryAfter: Math.ceil((resetAt - now) / 1000),
    };
  }
  return { ok: true, limit: maxRequests, remaining: Math.max(0, maxRequests - count), resetAt };
}

/**
 * Hybrid limiter: in-memory fast-reject, then the durable Mongo counter.
 * Falls back to the in-memory result if the durable store is unavailable.
 */
export async function durableRateLimit(
  identifier: string,
  maxRequests: number,
  windowMs: number
): Promise<RateLimitResult> {
  const local = checkRateLimit(identifier, maxRequests, windowMs);
  if (!local.ok) return local;
  try {
    return await mongoRateLimit(identifier, maxRequests, windowMs);
  } catch {
    // Storage unavailable: don't hard-block — defer to the local result.
    return local;
  }
}
