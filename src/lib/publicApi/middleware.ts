import type { NextResponse } from "next/server";
import { requirePublicBotToken } from "@/lib/api/requireBotToken";
import { validateUserApiKey } from "@/lib/api/userApiAuth";
import { rateLimitResponse, rateLimitHeaders, BOT_READ_LIMITS } from "@/lib/api/rateLimit";
import { durableRateLimit } from "@/lib/api/rateLimit.mongo";
import { logApiAccess } from "@/lib/api/accessLog";
import { publicError } from "./errors";

// Public API responses are read-only game state — safe to cache at the edge.
// Turn cadence is 1 hour; 30s s-maxage keeps CDN responses fresh enough for
// bots/dashboards without meaningful staleness. stale-while-revalidate gives
// a 60s grace window so origin spikes don't cause visible gaps.
// `no-transform` prevents Cloudflare from re-compressing the body with zstd,
// whose Content-Encoding some Android WebView builds cannot decode (the client
// fetch() then throws a "Network error"). Brotli/gzip are used instead. It is
// orthogonal to the edge caching below (s-maxage/stale-while-revalidate).
const PUBLIC_API_CACHE_HEADERS = {
  "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60, no-transform",
} as const;

/**
 * Outcome of {@link publicApiGuard}.
 * - `{ ok: false, response }` — return `response` immediately (401 or 429).
 * - `{ ok: true, headers }` — proceed, and spread `headers` onto the success
 *   response so it carries `X-RateLimit-*`.
 */
export type PublicApiGuardResult =
  { ok: false; response: NextResponse } | { ok: true; headers: Record<string, string> };

/**
 * Call at the top of every public API route handler.
 *
 * Accepts either:
 * - X-API-Key header with a valid user API key (public or private scope)
 * - X-Bot-Token header with the server's PUBLIC_BOT_API_KEY (existing behavior)
 *
 * On success returns the `X-RateLimit-*` headers to attach to the response.
 */
export async function publicApiGuard(
  request: Request,
  bucket: string
): Promise<PublicApiGuardResult> {
  // Try user API key first (X-API-Key header)
  const userKeyResult = await validateUserApiKey(request);
  if (userKeyResult.valid) {
    const rl = await durableRateLimit(
      `user-api:${bucket}:${userKeyResult.ownerUserId}`,
      BOT_READ_LIMITS.maxRequests,
      BOT_READ_LIMITS.windowMs
    );
    logApiAccess(request, {
      bucket,
      authType: "user-key",
      userId: userKeyResult.ownerUserId,
      keyId: userKeyResult.keyId,
      status: rl.ok ? 200 : 429,
    });
    if (!rl.ok) return { ok: false, response: rateLimitResponse(rl.retryAfter, undefined, rl) };
    return { ok: true, headers: { ...rateLimitHeaders(rl), ...PUBLIC_API_CACHE_HEADERS } };
  }

  // Fall back to existing bot token auth (X-Bot-Token header)
  if (!requirePublicBotToken(request)) {
    return {
      ok: false,
      response: publicError(
        "UNAUTHORIZED",
        "Invalid or missing API key. Use X-API-Key or X-Bot-Token header.",
        401
      ),
    };
  }
  const rl = await durableRateLimit(
    `public:v1:${bucket}`,
    BOT_READ_LIMITS.maxRequests,
    BOT_READ_LIMITS.windowMs
  );
  logApiAccess(request, { bucket, authType: "bot-token", status: rl.ok ? 200 : 429 });
  if (!rl.ok) return { ok: false, response: rateLimitResponse(rl.retryAfter, undefined, rl) };
  return { ok: true, headers: { ...rateLimitHeaders(rl), ...PUBLIC_API_CACHE_HEADERS } };
}
