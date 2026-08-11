import { NextResponse } from "next/server";
import { createHash } from "crypto";

/**
 * ETag-based conditional JSON response for polling endpoints.
 *
 * Returns the JSON with a strong ETag computed from the body. If the request's
 * `If-None-Match` already matches, returns a body-less `304 Not Modified`
 * instead. This keeps a polling endpoint fully LIVE — the client still
 * revalidates on every poll and sees new data the instant it changes — while
 * cutting egress to ~0 bytes whenever the payload is unchanged (the common case
 * between hourly turns).
 *
 * SAFE FOR PER-USER DATA: the response is recomputed per request and is never
 * written to a shared cache. `Cache-Control` stays `private`, so only the user's
 * own browser may revalidate it — there is no cross-user cache key to leak
 * through (unlike shared edge caching, which must be reserved for global data).
 *
 * We use `private, no-cache` (revalidate every time) rather than `no-store`
 * on purpose: `no-store` forbids the browser from issuing the conditional
 * request at all, which would defeat the 304. `no-cache` means "you may store
 * it, but must revalidate before reuse" — exactly the behaviour we want.
 */
export function conditionalJson(
  request: Request,
  data: unknown,
  init: { cacheControl?: string; status?: number; headers?: Record<string, string> } = {}
): NextResponse {
  const body = JSON.stringify(data);
  const etag = `"${createHash("sha1").update(body).digest("hex")}"`;
  // `no-transform` keeps Cloudflare from re-compressing the body with zstd,
  // whose Content-Encoding some Android WebView builds fail to decode (client
  // fetch() then throws a "Network error"). It does not affect cacheability or
  // the ETag/304 revalidation this helper exists for.
  const cacheControl = `${init.cacheControl ?? "private, no-cache"}, no-transform`;

  const ifNoneMatch = request.headers.get("if-none-match");
  if (ifNoneMatch && ifNoneMatch === etag) {
    return new NextResponse(null, {
      status: 304,
      headers: { ...init.headers, ETag: etag, "Cache-Control": cacheControl },
    });
  }

  return new NextResponse(body, {
    status: init.status ?? 200,
    headers: {
      ...init.headers,
      "Content-Type": "application/json",
      ETag: etag,
      "Cache-Control": cacheControl,
    },
  });
}
