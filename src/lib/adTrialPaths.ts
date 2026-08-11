// Flip to `false` to disable the player ad slot globally.
const ADS_ENABLED = true;

/**
 * Pages where the player ad banner renders.
 *
 * Scoped to public editorial/content surfaces only. Game UI, auth pages,
 * dashboards, private account screens, and policy pages (/privacy, /terms —
 * ad chrome on policy pages reads poorly to ad-network reviewers) are excluded.
 */
export const AD_BANNER_PATH_PREFIXES = [
  "/about",
  "/approval",
  "/campaign",
  "/changelog",
  "/contact",
  "/country",
  "/dashboard",
  "/guides",
  "/news",
  "/wiki",
] as const;

/** Returns true when the ad slot should render on this path. */
export function isAdBannerPath(pathname: string | null): boolean {
  if (!ADS_ENABLED) return false;
  if (!pathname) return false;
  return AD_BANNER_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}
