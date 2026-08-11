/**
 * Pure character-creation gate logic, shared by the edge middleware and the
 * server route handlers that maintain the hint cookie.
 *
 * This module MUST stay free of `next/headers`, `mongodb`, and other Node-only
 * imports: `middleware.ts` imports it and runs on the edge runtime. Anything
 * that writes the cookie (and therefore needs cookie options) lives in
 * `characterGateCookie.ts`, which is imported only by Node-runtime routes.
 */

/**
 * Non-httpOnly-agnostic hint cookie read by the middleware. It is a UX signal,
 * not a security boundary — every route's real data access is still guarded
 * server-side by `getAuthUserWithCharacter()`.
 */
export const CHARACTER_GATE_COOKIE = "ahd-needs-character";

/** Paths that are reachable without an active character (exact match). */
const ALLOWLIST_EXACT = new Set<string>(["/"]);

/**
 * Path prefixes that are reachable without an active character. A prefix `p`
 * matches `p` exactly or any path under `p/` — never a mere substring, so
 * `/login` does not allow `/loginbonus`.
 */
const ALLOWLIST_PREFIXES = [
  "/api",
  "/_next",
  // Character-creation destinations.
  "/create-character",
  "/create-imperial-character",
  // Auth + session entry/exit.
  "/login",
  "/register",
  "/logout",
  "/auth",
  // Status pages.
  "/banned",
  "/maintenance",
  "/unauthorized",
  "/retired",
  // Public season-recap share pages.
  "/wrapped",
  // Account management (link OAuth / change password / delete account).
  "/settings",
  // Public / legal / informational.
  "/about",
  "/terms",
  "/privacy",
  "/contact",
  "/faq",
  "/changelog",
  "/api-guide",
  "/guides",
  "/feedback",
];

/**
 * True when a logged-in player without an active character should be redirected
 * to `/create-character` from this path. Static assets, API routes, auth/status
 * pages, account management, and public pages are never gated.
 */
export function isCharacterGatedPath(pathname: string): boolean {
  if (ALLOWLIST_EXACT.has(pathname)) return false;

  // Static assets (a file extension in the final path segment) are never gated.
  const lastSegment = pathname.slice(pathname.lastIndexOf("/") + 1);
  if (lastSegment.includes(".")) return false;

  for (const prefix of ALLOWLIST_PREFIXES) {
    if (pathname === prefix || pathname.startsWith(prefix + "/")) return false;
  }

  return true;
}

/**
 * True when the hint cookie should be set (the user is a non-admin player with
 * no active character). Admins and moderators are exempt — they may operate
 * without a character — mirroring the post-login redirect logic.
 */
export function needsCharacterHint(args: {
  role: string;
  isAdmin?: boolean;
  hasCharacter: boolean;
}): boolean {
  return args.role === "player" && !args.isAdmin && !args.hasCharacter;
}
