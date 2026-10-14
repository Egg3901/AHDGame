"use client";

import { useEffect } from "react";
import { sendIntakeBeacon, sendIntakeBeaconOnce } from "@/lib/analytics/intakeBeacon";

type LandingCta = "register" | "login" | "discord" | "play_free" | "wiki";

/** Classify an anchor's destination into a landing call-to-action, or null. */
export function classifyLandingCta(href: string | null): LandingCta | null {
  if (!href) return null;
  if (/discord\.(gg|com)\//.test(href)) return "discord";
  let path: string;
  try {
    path = new URL(href, "https://ahousedividedgame.com").pathname;
  } catch {
    return null;
  }
  if (path.startsWith("/register")) return "register";
  if (path.startsWith("/login")) return "login";
  if (path.startsWith("/singleplayer") || path.startsWith("/download")) return "play_free";
  if (path.startsWith("/wiki")) return "wiki";
  return null;
}

/**
 * Anonymous landing counts for logged-out visitors: one view per page load and
 * which call-to-action they click. One delegated listener, so no link on the
 * page needs to know about analytics.
 */
export function LandingIntakeBeacon() {
  useEffect(() => {
    sendIntakeBeaconOnce("landing_viewed", "landing_viewed", { surface: "landing" });
    const onClick = (event: MouseEvent) => {
      const anchor = (event.target as Element | null)?.closest?.("a");
      const cta = classifyLandingCta(anchor?.getAttribute("href") ?? null);
      if (cta) sendIntakeBeacon("landing_cta_clicked", { surface: "landing", cta });
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);
  return null;
}
