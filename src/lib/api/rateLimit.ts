/**
 * In-memory rate limiter for API routes.
 * Per-IP limits. Works for single-instance deployments.
 * For serverless/multi-instance, consider @upstash/ratelimit + Redis.
 */
import { NextResponse } from "next/server";

const DEFAULT_WINDOW_MS = 60_000; // 1 minute
const DEFAULT_MAX_REQUESTS = 100;

interface Entry {
  count: number;
  resetAt: number;
}

/**
 * Result of a rate-limit check. `ok`/`retryAfter` are preserved for backward
 * compatibility with existing callers; `limit`/`remaining`/`resetAt` power the
 * `X-RateLimit-*` response headers.
 */
export interface RateLimitResult {
  ok: boolean;
  /** Max requests allowed in the window. */
  limit: number;
  /** Requests remaining in the current window (0 when over limit). */
  remaining: number;
  /** Epoch milliseconds at which the current window resets. */
  resetAt: number;
  /** Seconds until reset. Present (and meaningful) when `ok` is false. */
  retryAfter?: number;
}

const store = new Map<string, Entry>();

function prune() {
  const now = Date.now();
  for (const [key, entry] of store.entries()) {
    if (entry.resetAt < now) store.delete(key);
  }
}

/**
 * Check if the identifier is over the rate limit.
 * @param identifier - Usually client IP
 * @param maxRequests - Max requests per window (default 100)
 * @param windowMs - Window in ms (default 60_000)
 * @returns { ok: true } or { ok: false, retryAfter: seconds }
 */
export function checkRateLimit(
  identifier: string,
  maxRequests = DEFAULT_MAX_REQUESTS,
  windowMs = DEFAULT_WINDOW_MS
): RateLimitResult {
  if (!identifier || identifier === "unknown") {
    // Unknown IPs share a single bucket — prevents the "no IP = no limit" bypass
    // while still allowing legitimate proxied traffic at a reduced rate.
    identifier = "__unknown_ip__";
  }

  const now = Date.now();
  if (store.size > 10_000) prune();

  let entry = store.get(identifier);
  if (!entry || entry.resetAt < now) {
    entry = { count: 0, resetAt: now + windowMs };
    store.set(identifier, entry);
  }

  entry.count++;
  const remaining = Math.max(0, maxRequests - entry.count);
  if (entry.count > maxRequests) {
    return {
      ok: false,
      limit: maxRequests,
      remaining: 0,
      resetAt: entry.resetAt,
      retryAfter: Math.ceil((entry.resetAt - now) / 1000),
    };
  }
  return { ok: true, limit: maxRequests, remaining, resetAt: entry.resetAt };
}

/**
 * Build the standard `X-RateLimit-*` headers from a {@link RateLimitResult}
 * (or any object carrying limit/remaining/resetAt). Attach to successful
 * responses so integrators can see their remaining quota before hitting 429.
 * `X-RateLimit-Reset` is expressed in epoch seconds (Unix), the common convention.
 */
export function rateLimitHeaders(meta: {
  limit: number;
  remaining: number;
  resetAt: number;
}): Record<string, string> {
  return {
    "X-RateLimit-Limit": String(meta.limit),
    "X-RateLimit-Remaining": String(meta.remaining),
    "X-RateLimit-Reset": String(Math.ceil(meta.resetAt / 1000)),
  };
}

/**
 * Build the standard 429 Too Many Requests response.
 * Always paired with a failed checkRateLimit() call.
 *
 * Usage:
 *   if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);
 */
export function rateLimitResponse(
  retryAfter?: number,
  message?: string,
  meta?: { limit: number; remaining: number; resetAt: number }
): NextResponse {
  const sec = retryAfter ?? 60;
  const headers: Record<string, string> = { "Retry-After": String(sec) };
  if (meta) Object.assign(headers, rateLimitHeaders(meta));
  return NextResponse.json(
    {
      error: message ?? "You’re sending requests too quickly. Please wait a moment and try again.",
      code: "rate_limited",
      retryAfterSeconds: sec,
    },
    { status: 429, headers }
  );
}

/** Stricter limit for auth endpoints (login, register) to mitigate brute force. */
export const AUTH_LIMITS = { maxRequests: 10, windowMs: 60_000 };

/** Limit for feedback (bug/suggestion) to prevent spam. */
export const FEEDBACK_LIMITS = { maxRequests: 5, windowMs: 60_000 };

/** Player suggestion submissions — one per 30 minutes per user or IP. */
export const SUGGESTION_SUBMIT_LIMITS = { maxRequests: 1, windowMs: 30 * 60 * 1000 };

/** Limit for congress actions (propose, vote, cosponsor, uncosponsor, withdraw, presidential_action) per user. */
export const CONGRESS_LIMITS = { maxRequests: 30, windowMs: 60_000 };

/** Limit for election actions (enter, withdraw, vote) per user. */
export const ELECTION_LIMITS = { maxRequests: 20, windowMs: 60_000 };

/** Limit for savings wallet mutations (open, deposit, withdraw) per user. */
export const SAVINGS_WALLET_LIMITS = { maxRequests: 30, windowMs: 60_000 };

/** Limit for Discord bot read endpoints (elections, party, leaderboard, etc.) — global per endpoint. */
export const BOT_READ_LIMITS = { maxRequests: 60, windowMs: 60_000 };

/** Limit for Discord bot financial read endpoints (bonds, financials, stock-chart). */
export const BOT_FINANCIAL_LIMITS = { maxRequests: 30, windowMs: 60_000 };

/** Limit for Discord bot blackjack mutation endpoints (place-wager, resolve, wager). */
export const BOT_BLACKJACK_LIMITS = { maxRequests: 20, windowMs: 60_000 };

/** First-party page-view ingest — generous per-IP cap for SPA navigations. */
export const ANALYTICS_PAGE_VIEW_LIMITS = { maxRequests: 200, windowMs: 60_000 };
