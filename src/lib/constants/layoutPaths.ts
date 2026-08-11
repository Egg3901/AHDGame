export const LIGHTWEIGHT_LAYOUT_PATH_PREFIXES = ["/about", "/contact", "/privacy", "/terms"];

export function isLightweightLayoutPath(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  return LIGHTWEIGHT_LAYOUT_PATH_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}
