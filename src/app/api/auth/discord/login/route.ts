import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getDiscordOAuthUrl } from "@/lib/discord";
import { getBaseUrl, getClientIp } from "@/lib/utils/network";
import { AUTH_LIMITS, checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { getOAuthStateCookieOptions } from "@/lib/auth";
import {
  DISCORD_OAUTH_RETURN_URL_COOKIE,
  safeLakesideLoginReturn,
} from "@/lib/auth/lakesideLoginReturn";
import { randomBytes } from "crypto";

// GET /api/auth/discord/login — Initiates the Discord OAuth flow for login by redirecting to Discord's authorization page.
// Auth: public
// Errors: 429
export async function GET(request: Request) {
  const baseUrl = getBaseUrl(request);
  const clientIp = await getClientIp();
  const limit = checkRateLimit(clientIp, AUTH_LIMITS.maxRequests, AUTH_LIMITS.windowMs);
  if (!limit.ok) return rateLimitResponse(limit.retryAfter);
  try {
    const clientId = process.env.DISCORD_CLIENT_ID;
    const redirectUri = process.env.DISCORD_REDIRECT_URI;

    if (!clientId || !redirectUri) {
      return NextResponse.redirect(
        new URL("/login?discord=error&reason=discord_not_configured", baseUrl)
      );
    }

    // Generate state token for CSRF protection
    const state = randomBytes(32).toString("hex");

    // Store state and mode in cookies (shared domain so they survive www ↔ apex hops)
    const cookieStore = await cookies();
    const oauthCookieOpts = await getOAuthStateCookieOptions();
    cookieStore.set("discord_oauth_state", state, oauthCookieOpts);
    cookieStore.set("discord_oauth_mode", "login", oauthCookieOpts);

    // Preserve Lakeside SSO continuation across the Discord round-trip (ops dash).
    const lakesideReturn = safeLakesideLoginReturn(
      new URL(request.url).searchParams.get("returnTo")
    );
    if (lakesideReturn) {
      cookieStore.set(DISCORD_OAUTH_RETURN_URL_COOKIE, lakesideReturn, oauthCookieOpts);
    }

    const oauthUrl = getDiscordOAuthUrl(state, redirectUri, clientId);
    return NextResponse.redirect(oauthUrl);
  } catch (error) {
    console.error("[Discord login] Error:", error);
    return NextResponse.redirect(new URL("/login?discord=error&reason=exchange_failed", baseUrl));
  }
}
