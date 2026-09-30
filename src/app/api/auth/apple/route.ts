import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { ObjectId } from "mongodb";
import { randomBytes } from "crypto";
import { getAuthUser, getOAuthStateCookieOptions, verifyAuth } from "@/lib/auth";
import { getDb } from "@/lib/mongodb";
import type { User } from "@/lib/db/types";
import { credentialSessionIsCurrent } from "@/lib/auth/credentialSession";
import {
  PROVIDER_LINK_CONTEXT_TTL_SECONDS,
  providerLinkContextCookieName,
  sealProviderLinkContext,
} from "@/lib/auth/providerLinkContext";
import { getAppleAuthorizeUrl, getAppleSignInConfig } from "@/lib/auth/apple";
import { getBaseUrl, getClientIp } from "@/lib/utils/network";
import { AUTH_LIMITS, checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { withNoStore } from "@/lib/api/withNoStore";

// GET /api/auth/apple — Starts Sign in with Apple to link an Apple ID to the signed-in user.
// Auth: required (redirects to /login when unauthenticated)
// Errors: 429
// Link start carries per-account state: withNoStore keeps every response uncached.
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

    const config = getAppleSignInConfig();
    if (!config) {
      return NextResponse.redirect(new URL("/settings?apple=error&reason=not_configured", baseUrl));
    }

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

    const state = randomBytes(32).toString("hex");
    const nonce = randomBytes(32).toString("hex");

    const cookieStore = await cookies();
    const oauthCookieOpts = await getOAuthStateCookieOptions();
    cookieStore.set("apple_oauth_state", state, oauthCookieOpts);
    cookieStore.set("apple_oauth_nonce", nonce, oauthCookieOpts);
    cookieStore.set("apple_oauth_mode", "link", oauthCookieOpts);
    // Host-only start-to-callback binding, as in the Google and Discord link routes.
    const { domain: _linkCtxDomain, ...linkCtxOpts } = await getOAuthStateCookieOptions(
      PROVIDER_LINK_CONTEXT_TTL_SECONDS
    );
    void _linkCtxDomain;
    cookieStore.set(
      providerLinkContextCookieName("apple"),
      sealProviderLinkContext({
        provider: "apple",
        userId: user.userId,
        iat: auth.iat as number,
        state,
      }),
      linkCtxOpts
    );

    return NextResponse.redirect(getAppleAuthorizeUrl(config, state, nonce));
  } catch (error) {
    console.error("[Apple link] Error:", error);
    return NextResponse.redirect(new URL("/settings?apple=error&reason=exchange_failed", baseUrl));
  }
});
