import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getAuthUser, getOAuthStateCookieOptions } from "@/lib/auth";
import { getGoogleOAuthUrl } from "@/lib/google";
import { getBaseUrl, getClientIp } from "@/lib/utils/network";
import { AUTH_LIMITS, checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { randomBytes } from "crypto";

// GET /api/auth/google — Initiates the Google OAuth flow to link a Google account to the signed-in user.
// Auth: required (redirects to /login when unauthenticated)
// Errors: 429
export async function GET(request: Request) {
  const baseUrl = getBaseUrl(request);
  const clientIp = await getClientIp();
  const limit = checkRateLimit(clientIp, AUTH_LIMITS.maxRequests, AUTH_LIMITS.windowMs);
  if (!limit.ok) return rateLimitResponse(limit.retryAfter);
  try {
    const user = await getAuthUser();
    if (!user) {
      return NextResponse.redirect(new URL("/login", baseUrl));
    }

    const clientId = process.env.GOOGLE_CLIENT_ID;
    const redirectUri = process.env.GOOGLE_REDIRECT_URI;

    if (!clientId || !redirectUri) {
      return NextResponse.redirect(
        new URL("/settings?google=error&reason=not_configured", baseUrl)
      );
    }

    const state = randomBytes(32).toString("hex");

    const cookieStore = await cookies();
    const oauthCookieOpts = await getOAuthStateCookieOptions();
    cookieStore.set("google_oauth_state", state, oauthCookieOpts);
    cookieStore.set("google_oauth_mode", "link", oauthCookieOpts);

    const oauthUrl = getGoogleOAuthUrl(state, redirectUri, clientId);
    return NextResponse.redirect(oauthUrl);
  } catch (error) {
    console.error("[Google link] Error:", error);
    return NextResponse.redirect(new URL("/settings?google=error&reason=exchange_failed", baseUrl));
  }
}
