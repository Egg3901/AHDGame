"use client";

import { usePathname } from "next/navigation";
import { isAdSenseContentPath } from "@/lib/adsenseContent";
import { AdSenseUnit } from "./AdSenseUnit";

/**
 * Footer-level AdSense slot placed once in the root layout.
 *
 * Renders only on explicitly reviewed, editor-owned explanatory content.
 */
export function AdSenseSlot() {
  const pathname = usePathname();

  if (!isAdSenseContentPath(pathname)) return null;

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
