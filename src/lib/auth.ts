import { cache } from "react";
import { cookies, headers } from "next/headers";
import { jwtVerify, errors as joseErrors } from "jose";
import { ObjectId, type Db } from "mongodb";
import { z } from "zod";
import * as Sentry from "@sentry/nextjs";
import { getDb } from "@/lib/mongodb";
import { getCharactersCollection, getUsersCollection } from "@/lib/db/collections";
import { getCachedUser, setCachedUser } from "@/lib/auth/userDocCache";
import type { Character, User } from "@/lib/db/types";
import { getValidatedEnv } from "@/lib/env";
import { AUTH_COOKIE_NAME } from "@/lib/authCookieName";
import { CHARACTER_GATE_COOKIE } from "@/lib/auth/characterGate";

const CANONICAL_COOKIE_DOMAIN = ".ahousedividedgame.com";

function resolveCookieDomainFromHostname(hostname: string | null | undefined): string | undefined {
  if (!hostname) return undefined;
  const normalizedHost = hostname.trim().toLowerCase().replace(/:\d+$/, "");
  if (!normalizedHost) return undefined;

  return normalizedHost === "ahousedividedgame.com" ||
    normalizedHost.endsWith(".ahousedividedgame.com")
    ? CANONICAL_COOKIE_DOMAIN
    : undefined;
}

/** Scan a possibly comma-separated host list (X-Forwarded-Host can be multi-valued). */
function resolveCookieDomainFromHostHeader(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined;
  for (const part of raw.split(",")) {
    const domain = resolveCookieDomainFromHostname(part);
    if (domain) return domain;
  }
  return undefined;
}

function resolveCookieDomainFromBaseUrl(baseUrl: string | undefined): string | undefined {
  if (!baseUrl) return undefined;

  try {
    return resolveCookieDomainFromHostname(new URL(baseUrl).hostname);
  } catch {
    return undefined;
  }
}

/**
 * Parent-domain cookie so auth.ahousedividedgame.com (lakeside-auth ingress)
 * can read the session after login on the apex/www host.
 *
 * Gotcha: do NOT trust only the first X-Forwarded-Host value, and do NOT fall
 * back to VERCEL_ENV — this app runs on Railway. A missing Domain makes the
 * cookie host-only on the apex, so Ops SSO bounces to /profile instead of
 * completing the auth.ahousedividedgame.com handoff.
 */
async function getCookieDomain(): Promise<string | undefined> {
  try {
    const headerStore = await headers();
    // Prefer Host (browser target) then X-Forwarded-Host; accept any list entry
    // that is an AHD hostname (Railway sometimes prefixes its own host).
    for (const headerName of ["host", "x-forwarded-host"] as const) {
      const domain = resolveCookieDomainFromHostHeader(headerStore.get(headerName));
      if (domain) return domain;
    }
  } catch {
    // Some tests and utility-only code paths run without an active request scope.
  }

  return (
    resolveCookieDomainFromBaseUrl(process.env.NEXT_PUBLIC_BASE_URL?.trim()) ??
    (process.env.RAILWAY_ENVIRONMENT_NAME || process.env.VERCEL_ENV === "production"
      ? CANONICAL_COOKIE_DOMAIN
      : undefined)
  );
}

export function getJwtSecret(): Uint8Array {
  const secret =
    process.env.NODE_ENV === "test"
      ? (process.env.AUTH_SECRET ?? "test-secret-placeholder")
      : getValidatedEnv().AUTH_SECRET;

  return new TextEncoder().encode(secret);
}

async function buildCookieOptions(maxAge: number) {
  const cookieDomain = await getCookieDomain();

  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    maxAge,
    path: "/",
    ...(cookieDomain ? { domain: cookieDomain } : {}),
  };
}

/** OAuth flow cookie options (state, mode, returnUrl) — same domain as auth cookies. */
export async function getOAuthStateCookieOptions(maxAge: number = 300) {
  return buildCookieOptions(maxAge);
}

/** Shared auth cookie options - use for all `auth-token` cookie sets. */
export async function getAuthCookieOptions() {
  return buildCookieOptions(60 * 60 * 24 * 7); // 7 days
}

/** Shared tracking cookie options - use for all `__ahd_track` cookie sets. */
export async function getTrackingCookieOptions() {
  return buildCookieOptions(60 * 60 * 24 * 180); // ~6 months
}

/** Shape enforced after JWT verification - rejects malformed or unexpected claim objects. */
export const userPayloadSchema = z.object({
  userId: z.string(),
  email: z.string(),
  username: z.string(),
  role: z.string(),
  isAdmin: z.boolean().optional(),
  iat: z.number().optional(),
});

export type UserPayload = z.infer<typeof userPayloadSchema>;

function isAuthTokenRevoked(user: User, payload: UserPayload): boolean {
  if (!user.authRevokedAt) return false;
  if (typeof payload.iat !== "number") return true;
  return user.authRevokedAt.getTime() >= payload.iat * 1000;
}

// Auth-clear reasons that are genuinely anomalous (a *valid* token whose user
// is gone or banned) and warrant their own GlitchTip event. Everything else
// (expired/rotated tokens → user_null, deliberate logout) is routine and is
// recorded as a breadcrumb only, so it provides forensic context before a real
// error without flooding the dashboard with tens of thousands of "events".
const SUSPICIOUS_AUTH_CLEAR_REASONS = new Set([
  "auth_me:user_banned",
  "auth_me:user_not_found",
  "user_delete_account",
]);

/**
 * Clear the auth-token cookie.
 *
 * `reason` is required for diagnostic instrumentation. It is always recorded as
 * a Sentry breadcrumb (so the session-clear shows up in the trail before any
 * subsequent auth error), and *suspicious* reasons additionally raise a
 * warning-level event. Use a stable identifier like `route_path:condition`
 * (e.g. `client_nav:user_lookup_null`) so tag-based filters group cleanly.
 */
export async function clearAuthCookie(reason: string) {
  // Breadcrumb (not an event): forensic context that survives into the next
  // captured error in this scope, without creating its own GlitchTip issue.
  Sentry.addBreadcrumb({
    category: "auth",
    type: "info",
    level: "info",
    message: `Auth cookie cleared (${reason})`,
    data: { reason },
  });
  // Only genuinely anomalous clears become their own event.
  if (SUSPICIOUS_AUTH_CLEAR_REASONS.has(reason)) {
    Sentry.captureMessage(`Suspicious auth cookie clear (${reason})`, {
      level: "warning",
      tags: { component: "auth", action: "cookie_cleared", reason },
    });
  }
  try {
    const cookieStore = await cookies();
    if (typeof cookieStore.set !== "function") return;
    const expired = { ...(await getAuthCookieOptions()), maxAge: 0 };
    cookieStore.set(AUTH_COOKIE_NAME, "", expired);
    // Tear down the character-creation hint cookie alongside the session so a
    // logged-out browser is never redirected to /create-character.
    cookieStore.set(CHARACTER_GATE_COOKIE, "", expired);
  } catch {
    // Some tests and utility-only invocations run without an active request scope.
    // In those contexts we still want the auth guard to fail closed rather than
    // turning a 401/403 path into a 500 while attempting cookie cleanup.
  }
}

function mapUserToAuthUser(user: User, payload: UserPayload): AuthUser {
  return {
    userId: payload.userId,
    username: payload.username,
    email: payload.email,
    role: payload.role,
    isAdmin: user.isAdmin === true || user.role === "admin" || payload.isAdmin === true,
    isModerator:
      user.role === "moderator" ||
      user.role === "admin" ||
      user.isAdmin === true ||
      payload.isAdmin === true,
    isBanned: user.isBanned === true,
    activeCharacterId: user.activeCharacterId ? user.activeCharacterId.toString() : null,
  };
}

export interface AuthUser {
  userId: string;
  username: string;
  email: string;
  role: string;
  isAdmin?: boolean;
  isModerator?: boolean;
  /** True when the underlying user has been banned. Read directly from the DB
   * record on every auth resolution so banned accounts with stale JWTs are
   * caught immediately without waiting for cookie expiry. */
  isBanned?: boolean;
  /** Multi-profile aware: the user's currently-active character id (hex) or null. */
  activeCharacterId?: string | null;
}

export interface AuthUserWithCharacter extends AuthUser {
  hasCharacter: boolean;
  character?: Character;
}

/**
 * Verify JWT token and return user payload
 * Returns null if token is invalid or missing
 * Note: This only validates the JWT - use getAuthUser() to also verify user exists in DB
 */
export async function verifyAuth(): Promise<UserPayload | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(AUTH_COOKIE_NAME)?.value;

  if (!token) {
    Sentry.addBreadcrumb({
      category: "auth.verify",
      level: "info",
      message: "verifyAuth: no auth-token cookie",
    });
    return null;
  }

  // `jose` throws `JOSEError` (or a subclass like `JWTExpired`,
  // `JWSSignatureVerificationFailed`) when the token itself is bad. Those
  // map to "log this user out" — return null. Anything else (env validation
  // hiccup, unexpected SDK error, etc.) is a transient failure and MUST
  // propagate so the caller returns 5xx without clearing the auth cookie;
  // previously a bare `catch { return null }` here let any transient throw
  // log users out at random.
  let payload: unknown;
  try {
    ({ payload } = await jwtVerify(token, getJwtSecret()));
  } catch (err) {
    if (err instanceof joseErrors.JOSEError) {
      Sentry.addBreadcrumb({
        category: "auth.verify",
        level: "info",
        message: `verifyAuth: JOSE error (${err.name})`,
        data: { name: err.name, joseMessage: err.message },
      });
      return null;
    }
    throw err;
  }

  const parsed = userPayloadSchema.safeParse(payload);
  if (!parsed.success) {
    Sentry.addBreadcrumb({
      category: "auth.verify",
      level: "info",
      message: "verifyAuth: payload schema rejected",
      data: { issues: parsed.error.issues.slice(0, 3) },
    });
    return null;
  }
  return parsed.data;
}

/**
 * Resolve the user document for an authenticated session.
 *
 * Reads through the short-TTL process cache (`userDocCache`) so the many
 * parallel `/api/*` requests a single page fires don't each re-hit the DB just
 * to enforce ban / token-revocation. Ban + revoke paths invalidate the cache,
 * so enforcement stays effectively immediate; the TTL is the upper bound for
 * anything we don't explicitly invalidate.
 */
async function resolveUserDoc(db: Db, userId: string): Promise<User | null> {
  const cached = getCachedUser(userId);
  if (cached) return cached;

  const users = await getUsersCollection(db);
  const user = await users.findOne({ _id: new ObjectId(userId) });
  if (user) setCachedUser(userId, user);
  return user;
}

/**
 * Get authenticated user from JWT token
 * Returns null if not authenticated or user no longer exists in database
 *
 * Wrapped in React `cache()` so repeated calls within a single server render
 * (a page that resolves the viewer in several components) share one resolution.
 */
export const getAuthUser = cache(async (): Promise<AuthUser | null> => {
  const payload = await verifyAuth();
  if (!payload) return null;

  // Verify user still exists in database (handles case where user was deleted)
  const user = await resolveUserDoc(await getDb(), payload.userId);

  if (!user) return null;
  if (user.isBanned === true) return null;
  if (isAuthTokenRevoked(user, payload)) return null;

  return mapUserToAuthUser(user, payload);
});

/**
 * Get authenticated user and check if they have a character
 * Returns null if not authenticated
 */
export const getAuthUserWithCharacter = cache(async (): Promise<AuthUserWithCharacter | null> => {
  const payload = await verifyAuth();
  if (!payload) return null;

  // Single DB handle for user + character lookups (avoids nested getAuthUser -> getDb + getDb).
  const db = await getDb();
  const user = await resolveUserDoc(db, payload.userId);

  if (!user) return null;
  if (user.isBanned === true) return null;
  if (isAuthTokenRevoked(user, payload)) return null;

  const authUser = mapUserToAuthUser(user, payload);
  const characters = await getCharactersCollection(db);
  // Resolve active character by activeCharacterId if set (multi-character support for admins),
  // falling back to userId lookup for regular players. The userId check in the activeCharacterId
  // path prevents a user from pointing to another user's character.
  const characterQuery = user.activeCharacterId
    ? { _id: user.activeCharacterId, userId: new ObjectId(authUser.userId) }
    : { userId: new ObjectId(authUser.userId) };
  const character = await characters.findOne(characterQuery);

  return {
    ...authUser,
    hasCharacter: !!character,
    character: character || undefined,
  };
});

/**
 * Get authenticated admin user
 * Returns null if not authenticated or not admin
 */
export async function getAuthAdmin(): Promise<AuthUserWithCharacter | null> {
  const user = await getAuthUserWithCharacter();
  if (!user || !user.isAdmin) return null;

  return user;
}

/**
 * Get authenticated moderator or admin user.
 * Returns null if not authenticated or not at least moderator role.
 */
export async function getAuthModerator(): Promise<AuthUserWithCharacter | null> {
  const user = await getAuthUserWithCharacter();
  if (!user || !user.isModerator) return null;

  return user;
}
