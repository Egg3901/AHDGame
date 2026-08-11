/**
 * Per-deployment auth cookie name.
 *
 * The auth-token cookie historically used the literal name `auth-token` on
 * the parent domain `.ahousedividedgame.com`, which made sandbox and live
 * sessions collide: any request to either subdomain with the other env's
 * JWT would fail the user lookup, clear the cookie, and log the user out
 * on both. Suffixing the cookie name with the Railway service tag isolates
 * the cookies per environment so both can coexist in one browser.
 *
 * Mirrors the slug derivation used by the Sentry cron monitor in cron.ts
 * so per-env identifiers stay consistent across the system.
 */
export function computeAuthCookieName(env: NodeJS.ProcessEnv = process.env): string {
  const tag = (env.RAILWAY_SERVICE_NAME ?? env.RAILWAY_ENVIRONMENT_NAME ?? "local")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `auth-token-${tag || "local"}`;
}

/** Resolved at module load — env is stable for the process lifetime. */
export const AUTH_COOKIE_NAME = computeAuthCookieName();
