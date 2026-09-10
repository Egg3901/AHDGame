import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { ObjectId } from "mongodb";
import { getAuthUser, getOAuthStateCookieOptions, verifyAuth } from "@/lib/auth"; // Optional auth — intentionally uses getAuthUser() for conditional redirect logic
import { getDb } from "@/lib/mongodb";
import type { User } from "@/lib/db/types";
import { credentialSessionIsCurrent } from "@/lib/auth/credentialSession";
import {
  PROVIDER_LINK_CONTEXT_TTL_SECONDS,
  providerLinkContextCookieName,
  sealProviderLinkContext,
} from "@/lib/auth/providerLinkContext";
import { getDiscordOAuthUrl } from "@/lib/discord";
import { getBaseUrl, getClientIp } from "@/lib/utils/network";
import { AUTH_LIMITS, checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { withNoStore } from "@/lib/api/withNoStore";
import { randomBytes } from "crypto";

// GET /api/auth/discord — Initiates the Discord OAuth flow for account linking by redirecting to Discord's authorization page.
// Auth: public (redirects to /login if not authenticated)
// Errors: 429
// Link start carries per-account state: withNoStore keeps every response
// (rate-limit, login redirect, provider redirect, error redirect) uncached.
export const GET = withNoStore(async function GET(request: Request) {
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

    // Link start requires the fresh current account/session, not the cached
    // grant alone: the sealed link context below binds this binding.
    const db = await getDb();
    const account = await db.collection<User>("users").findOne({ _id: new ObjectId(user.userId) });
    const auth = await verifyAuth();
    if (!account || !auth || !credentialSessionIsCurrent(user.userId, account, auth)) {
      return NextResponse.redirect(new URL("/login", baseUrl));
    }
    if (!Number.isSafeInteger(auth.iat)) {
      return NextResponse.redirect(new URL("/login", baseUrl));
    }

    // Generate state token for CSRF protection
    const state = randomBytes(32).toString("hex");

    // Store state, mode, and returnUrl in cookies (shared domain so they survive www ↔ apex hops)
    const cookieStore = await cookies();
    const oauthCookieOpts = await getOAuthStateCookieOptions();
    cookieStore.set("discord_oauth_state", state, oauthCookieOpts);
    cookieStore.set("discord_oauth_mode", "link", oauthCookieOpts);
    cookieStore.set("discord_oauth_return_url", returnUrl, oauthCookieOpts);
    // Start-to-callback binding: canonical userId plus the verified session
    // iat, provider, and CSRF state. Sealing throws without AUTH_SECRET, which
    // fails closed through the catch below. Host-only so only this host can
    // present it back (domain dropped from the shared OAuth cookie options).
    const { domain: _linkCtxDomain, ...linkCtxOpts } = await getOAuthStateCookieOptions(
      PROVIDER_LINK_CONTEXT_TTL_SECONDS
    );
    void _linkCtxDomain;
    cookieStore.set(
      providerLinkContextCookieName("discord"),
      sealProviderLinkContext({
        provider: "discord",
        userId: user.userId,
        iat: auth.iat as number,
        state,
      }),
      linkCtxOpts
    );

    const oauthUrl = getDiscordOAuthUrl(state, redirectUri, clientId);
    return NextResponse.redirect(oauthUrl);
  } catch (error) {
    console.error("[Discord link] Error:", error);
    return NextResponse.redirect(
      new URL("/settings?discord=error&reason=exchange_failed", baseUrl)
    );
  }
});
