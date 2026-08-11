import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getAuthUser, getOAuthStateCookieOptions } from "@/lib/auth"; // Optional auth — intentionally uses getAuthUser() for conditional redirect logic
import { getDiscordOAuthUrl } from "@/lib/discord";
import { getBaseUrl, getClientIp } from "@/lib/utils/network";
import { AUTH_LIMITS, checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { randomBytes } from "crypto";

// GET /api/auth/discord — Initiates the Discord OAuth flow for account linking by redirecting to Discord's authorization page.
// Auth: public (redirects to /login if not authenticated)
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

    const clientId = process.env.DISCORD_CLIENT_ID;
    const redirectUri = process.env.DISCORD_REDIRECT_URI;

    if (!clientId || !redirectUri) {
      return NextResponse.redirect(
        new URL("/settings?discord=error&reason=not_configured", baseUrl)
      );
    }

    // Accept an optional returnUrl so callers outside /settings (e.g.
    // create-character) can preserve their page after the OAuth flow.
    const reqUrl = new URL(request.url);
    const returnUrl = reqUrl.searchParams.get("returnUrl") ?? "/settings";

    // Generate state token for CSRF protection
    const state = randomBytes(32).toString("hex");

    // Store state, mode, and returnUrl in cookies (shared domain so they survive www ↔ apex hops)
    const cookieStore = await cookies();
    const oauthCookieOpts = await getOAuthStateCookieOptions();
    cookieStore.set("discord_oauth_state", state, oauthCookieOpts);
    cookieStore.set("discord_oauth_mode", "link", oauthCookieOpts);
    cookieStore.set("discord_oauth_return_url", returnUrl, oauthCookieOpts);

    const oauthUrl = getDiscordOAuthUrl(state, redirectUri, clientId);
    return NextResponse.redirect(oauthUrl);
  } catch (error) {
    console.error("[Discord link] Error:", error);
    return NextResponse.redirect(
      new URL("/settings?discord=error&reason=exchange_failed", baseUrl)
    );
  }
}
