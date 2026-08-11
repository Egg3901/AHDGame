import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getGoogleOAuthUrl } from "@/lib/google";
import { getBaseUrl, getClientIp } from "@/lib/utils/network";
import { AUTH_LIMITS, checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { getOAuthStateCookieOptions } from "@/lib/auth";
import {
  GOOGLE_OAUTH_RETURN_URL_COOKIE,
  safeLakesideLoginReturn,
} from "@/lib/auth/lakesideLoginReturn";
import { randomBytes } from "crypto";

// GET /api/auth/google/login — Initiates the Google OAuth flow for login by redirecting to Google's authorization page.
// Auth: public
// Errors: 429
export async function GET(request: Request) {
  const baseUrl = getBaseUrl(request);
  const clientIp = await getClientIp();
  const limit = checkRateLimit(clientIp, AUTH_LIMITS.maxRequests, AUTH_LIMITS.windowMs);
  if (!limit.ok) return rateLimitResponse(limit.retryAfter);
  try {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const redirectUri = process.env.GOOGLE_REDIRECT_URI;

    if (!clientId || !redirectUri) {
      return NextResponse.redirect(new URL("/login?google=error&reason=not_configured", baseUrl));
    }

    // CSRF state token.
    const state = randomBytes(32).toString("hex");

    // Shared-domain cookies so state survives www ↔ apex hops (the callback
    // returns on whatever host GOOGLE_REDIRECT_URI points at). Mirrors the
    // Discord login route.
    const cookieStore = await cookies();
    const oauthCookieOpts = await getOAuthStateCookieOptions();
    cookieStore.set("google_oauth_state", state, oauthCookieOpts);
    cookieStore.set("google_oauth_mode", "login", oauthCookieOpts);

    // Preserve Lakeside SSO continuation across the Google round-trip (ops dash).
    const lakesideReturn = safeLakesideLoginReturn(
      new URL(request.url).searchParams.get("returnTo")
    );
    if (lakesideReturn) {
      cookieStore.set(GOOGLE_OAUTH_RETURN_URL_COOKIE, lakesideReturn, oauthCookieOpts);
    }

    const oauthUrl = getGoogleOAuthUrl(state, redirectUri, clientId);
    return NextResponse.redirect(oauthUrl);
  } catch (error) {
    console.error("[Google login] Error:", error);
    return NextResponse.redirect(new URL("/login?google=error&reason=exchange_failed", baseUrl));
  }
}
