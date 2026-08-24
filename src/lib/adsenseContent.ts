/**
 * Public pages with durable, editor-owned explanatory content.
 *
 * Google-served ads must never appear in the game UI, account flows, live
 * feeds, or community-maintained pages. Keep this intentionally narrow: a
 * new route is opt-in only after its content is reviewed for ad suitability.
 */
const ADSENSE_CONTENT_EXACT_PATHS = new Set(["/about", "/faq"]);
const ADSENSE_CONTENT_PREFIXES = ["/guides/"] as const;

export function isAdSenseContentPath(pathname: string | null | undefined): boolean {
  if (!pathname) return false;

  const normalizedPathname = pathname.split("?", 1)[0]?.replace(/\/+$/, "") || "/";

  return (
    ADSENSE_CONTENT_EXACT_PATHS.has(normalizedPathname) ||
    normalizedPathname === "/guides" ||
    ADSENSE_CONTENT_PREFIXES.some((prefix) => normalizedPathname.startsWith(prefix))
  );
}
