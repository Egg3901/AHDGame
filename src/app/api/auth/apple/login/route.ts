import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { randomBytes } from "crypto";
import { getAppleAuthorizeUrl, getAppleSignInConfig } from "@/lib/auth/apple";
import { getBaseUrl, getClientIp } from "@/lib/utils/network";
import { AUTH_LIMITS, checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { getOAuthStateCookieOptions } from "@/lib/auth";
import {
  APPLE_OAUTH_RETURN_URL_COOKIE,
  safeLakesideLoginReturn,
} from "@/lib/auth/lakesideLoginReturn";

// GET /api/auth/apple/login — Starts Sign in with Apple for login or registration.
// Auth: public
// Errors: 429
export async function GET(request: Request) {
  const baseUrl = getBaseUrl(request);
  const clientIp = await getClientIp();
  const limit = checkRateLimit(clientIp, AUTH_LIMITS.maxRequests, AUTH_LIMITS.windowMs);
  if (!limit.ok) return rateLimitResponse(limit.retryAfter);
  try {
    const config = getAppleSignInConfig();
    if (!config) {
      return NextResponse.redirect(new URL("/login?apple=error&reason=not_configured", baseUrl));
    }

    const state = randomBytes(32).toString("hex");
    const nonce = randomBytes(32).toString("hex");

    const cookieStore = await cookies();
    const oauthCookieOpts = await getOAuthStateCookieOptions();
    cookieStore.set("apple_oauth_state", state, oauthCookieOpts);
    cookieStore.set("apple_oauth_nonce", nonce, oauthCookieOpts);
    cookieStore.set("apple_oauth_mode", "login", oauthCookieOpts);

    // Preserve Lakeside SSO continuation across the Apple round-trip (ops dash).
    const lakesideReturn = safeLakesideLoginReturn(
      new URL(request.url).searchParams.get("returnTo")
    );
    if (lakesideReturn) {
      cookieStore.set(APPLE_OAUTH_RETURN_URL_COOKIE, lakesideReturn, oauthCookieOpts);
    }

    return NextResponse.redirect(getAppleAuthorizeUrl(config, state, nonce));
  } catch (error) {
    console.error("[Apple login] Error:", error);
    return NextResponse.redirect(new URL("/login?apple=error&reason=exchange_failed", baseUrl));
  }
}
