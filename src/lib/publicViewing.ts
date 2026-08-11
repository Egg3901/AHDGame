import { getDb } from "@/lib/mongodb";
import type { GameConfig } from "@/lib/db/types";

/**
 * "Public viewing mode" — the master switch governing whether unauthenticated
 * clients may hit internal API **read** routes (the page-serving JSON the
 * browser renders). Defaults to ON so the site stays fully public; an admin
 * (or the `PUBLIC_VIEWING_MODE` env var) can turn it OFF to require a session
 * for internal reads, which blocks anonymous scrapers that bypass the
 * authenticated public API and hammer the internal routes at bot scale.
 *
 * Enforcement lives in `src/proxy.ts` (the Next.js middleware). This module
 * owns the cached flag read plus the allowlist of API paths that must stay
 * reachable even while the gate is engaged.
 */

/**
 * API path prefixes that remain public even when the read-gate is engaged.
 * Matched with `pathname.startsWith(prefix)`, so each entry keeps its trailing
 * slash to avoid matching sibling names (`/api/auth/` must not match
 * `/api/authx`). These are either self-protected (own key/token/signature
 * auth) or needed before a session can exist (login, status, embedded assets).
 */
export const ALWAYS_PUBLIC_API_PREFIXES: readonly string[] = [
  "/api/public/", // public API — own X-API-Key / X-Bot-Token + rate limit + logging
  "/api/v1/", // versioned public API surface
  "/api/discord-bot/", // Discord bot — own bot token
  "/api/auth/", // login / OAuth / session — must work before auth exists
  "/api/analytics/", // anonymous pageview logging
  "/api/webhooks/", // external callbacks — signature-verified
  "/api/cron/", // scheduled jobs — own cron secret
  "/api/flags/", // flag image assets embedded in public/login pages
  "/api/logos/", // party / coalition logo assets
  "/api/images/", // hero / action image assets
  "/api/uploads/", // user-uploaded asset serving
];

/**
 * Exact API paths that remain public even when the read-gate is engaged.
 * Used for single endpoints that have no public subtree.
 */
export const ALWAYS_PUBLIC_API_PATHS: readonly string[] = [
  "/api/health", // infra health probe
  "/api/maintenance", // maintenance status — read by the login/maintenance pages
  "/api/error-codes", // static error reference
];

/** True when `pathname` stays reachable to anonymous reads while the gate is on. */
export function isPublicApiReadBypassPath(pathname: string): boolean {
  return (
    ALWAYS_PUBLIC_API_PATHS.includes(pathname) ||
    ALWAYS_PUBLIC_API_PREFIXES.some((prefix) => pathname.startsWith(prefix))
  );
}

let publicViewingCache: { value: boolean; expiresAt: number } | null = null;
// Short TTL so an admin toggle takes effect quickly without a deploy or restart.
const PUBLIC_VIEWING_CACHE_TTL_MS = 60 * 1000;

/** Drop the in-memory snapshot so the next read goes back to the DB. Call when
 *  an admin toggles public viewing mode so the serving process picks up the new
 *  state on its next request instead of waiting out the TTL. Other server
 *  processes still see stale state until their own TTL elapses. */
export function invalidatePublicViewingCache(): void {
  publicViewingCache = null;
}

/**
 * Resolve whether public viewing mode is enabled (anonymous reads allowed).
 *
 * Precedence: `PUBLIC_VIEWING_MODE` env override → cached DB flag. The DB flag
 * defaults to **enabled** — only an explicit `false` engages the gate — so a
 * fresh/legacy config and any transient lookup gap both fail open (public).
 */
export async function getCachedPublicViewingMode(): Promise<boolean> {
  const envOverride = process.env.PUBLIC_VIEWING_MODE;
  if (envOverride === "true") return true;
  if (envOverride === "false") return false;

  const now = Date.now();
  if (publicViewingCache && now < publicViewingCache.expiresAt) {
    return publicViewingCache.value;
  }

  const db = await getDb();
  const config = await db
    .collection<GameConfig>("gameConfig")
    .findOne({ _id: "default" }, { projection: { publicViewingMode: 1 } });

  // Default ON: absent/undefined => enabled; only an explicit `false` locks reads.
  const value = config?.publicViewingMode !== false;

  publicViewingCache = { value, expiresAt: now + PUBLIC_VIEWING_CACHE_TTL_MS };
  return value;
}
