export const LIGHTWEIGHT_LAYOUT_PATH_PREFIXES = ["/about", "/contact", "/privacy", "/terms"];

/**
 * Pages that render with no site chrome: no navbar, no bug-report button, no
 * page-wide banners. Anything mounted at the layout root and drawn above
 * `<main>` has to check this, or it ends up floating at the very top of a page
 * with nothing above it.
 *
 * Exact matches, never prefixes, because these are single pages rather than
 * subtrees. Shared by `NavbarWrapper`, `BugReportFab` and `PollBannerNotice` so
 * the chrome cannot disagree with itself about where it is hidden. Several other
 * components keep their own `EXCLUDED_PATHS` with DIFFERENT membership (some add
 * "/", some drop "/maintenance"); those are separate rules and are deliberately
 * not folded in here.
 */
export const CHROME_HIDDEN_PATHS = ["/login", "/register", "/banned", "/maintenance"];

export function isChromeHiddenPath(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  return CHROME_HIDDEN_PATHS.includes(pathname);
}

export function isLightweightLayoutPath(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  return LIGHTWEIGHT_LAYOUT_PATH_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}
