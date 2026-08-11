import { NextResponse } from "next/server";
import { forbidden } from "@/lib/api/errors";

/**
 * Origin/Referer validation for state-changing, human-only endpoints.
 *
 * This is defense-in-depth alongside the `sameSite: lax` auth cookie (which
 * already blocks most cross-site cookie use) and an anti-automation signal: a
 * script driving the site from another origin will be rejected.
 *
 * Policy:
 *   - No Origin/Referer header → allow. Browsers omit Origin on same-origin
 *     GETs, and same-site navigations may carry neither; the cookie's sameSite
 *     attribute is the backstop there. We do not block header-less requests.
 *   - Origin host equals the request Host → allow (same-origin, covers every
 *     deployment — prod, Railway preview, localhost — with no hardcoding).
 *   - Origin host in the explicit allowlist (NEXT_PUBLIC_BASE_URL + the
 *     comma-separated ALLOWED_ORIGINS env) → allow.
 *   - Otherwise → 403.
 */
function hostOf(headerValue: string | null): string | null {
  if (!headerValue) return null;
  try {
    return new URL(headerValue).host;
  } catch {
    return null;
  }
}

function allowedOriginHosts(): Set<string> {
  const hosts = new Set<string>();
  const base = hostOf(process.env.NEXT_PUBLIC_BASE_URL ?? null);
  if (base) hosts.add(base);
  for (const raw of (process.env.ALLOWED_ORIGINS ?? "").split(",")) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    // Accept either a bare host or a full URL.
    hosts.add(hostOf(trimmed) ?? trimmed);
  }
  return hosts;
}

/**
 * Returns a 403 response if the request's Origin/Referer is cross-origin and
 * not allowlisted, or `null` if the request may proceed.
 */
export function assertSameOrigin(request: Request): NextResponse | null {
  const claimedHost =
    hostOf(request.headers.get("origin")) ?? hostOf(request.headers.get("referer"));
  if (!claimedHost) return null;

  const host = request.headers.get("host");
  if (host && claimedHost === host) return null;

  if (allowedOriginHosts().has(claimedHost)) return null;

  return NextResponse.json(forbidden("Cross-origin request rejected.").toJson(), { status: 403 });
}
