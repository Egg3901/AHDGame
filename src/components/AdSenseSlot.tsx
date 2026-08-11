"use client";

import { usePathname } from "next/navigation";
import { AdSenseUnit } from "./AdSenseUnit";

/**
 * Paths where AdSense ad units are allowed to render.
 *
 * Scoped to public editorial/content surfaces. Game UI, auth pages,
 * dashboards, private account screens, and policy pages are excluded.
 */
const ADSENSE_ALLOWED_PATH_PREFIXES = [
  "/about",
  "/changelog",
  "/contact",
  "/faq",
  "/guides",
  "/news",
  "/wiki",
] as const;

function isAdSenseAllowedPath(pathname: string | null): boolean {
  if (!pathname) return false;
  return ADSENSE_ALLOWED_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

/**
 * Footer-level AdSense slot placed once in the root layout.
 *
 * Renders a responsive auto-ad unit on editorial pages only.
 * Returns null on game pages, auth pages, and policy pages to stay
 * within AdSense placement best-practices.
 */
export function AdSenseSlot() {
  const pathname = usePathname();

  if (!isAdSenseAllowedPath(pathname)) return null;

  return (
    <div className="w-full border-t border-card-border bg-card px-4 py-3 sm:px-6">
      <div className="mx-auto max-w-7xl">
        {/* key forces a fresh <ins> per route: adsbygoogle has no destroy API,
            so remounting is the supported way to refresh units in an SPA. */}
        <AdSenseUnit
          key={pathname}
          slot="ahd-footer-responsive"
          format="auto"
          className="min-h-[90px]"
        />
      </div>
    </div>
  );
}
