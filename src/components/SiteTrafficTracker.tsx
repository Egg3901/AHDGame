"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

const DEDUPE_MS = 2500;

/**
 * Best-effort page load duration in milliseconds. Uses the Navigation Timing
 * API's `loadEventEnd - startTime`. Returns null when unavailable or clearly
 * stale (e.g. we're on the same page via client-side routing, which is handled
 * by the dedupe guard above anyway). Client-side route changes don't update
 * the navigation entry, so for SPA transitions this still reports the initial
 * page load time — that's acceptable for our "slowest pages" signal because
 * SSR cost dominates client render cost.
 */
function readNavigationDurationMs(): number | null {
  if (typeof performance === "undefined" || !performance.getEntriesByType) return null;
  const nav = performance.getEntriesByType("navigation")[0] as
    PerformanceNavigationTiming | undefined;
  if (!nav) return null;
  const end = nav.loadEventEnd || nav.domContentLoadedEventEnd || nav.responseEnd;
  if (!end || end <= 0) return null;
  const duration = Math.round(end);
  if (!Number.isFinite(duration) || duration <= 0 || duration > 120_000) return null;
  return duration;
}

/**
 * Deferred first-party page view ping — runs after paint via requestIdleCallback
 * (or setTimeout fallback) and prefers sendBeacon so navigations are not blocked.
 */
export function SiteTrafficTracker() {
  const pathname = usePathname();
  const lastRef = useRef<{ path: string; at: number } | null>(null);

  useEffect(() => {
    if (!pathname) return;

    const now = Date.now();
    const last = lastRef.current;
    if (last && last.path === pathname && now - last.at < DEDUPE_MS) return;
    lastRef.current = { path: pathname, at: now };

    const send = () => {
      const loadTimeMs = readNavigationDurationMs();
      const body = JSON.stringify({
        path: pathname,
        ...(loadTimeMs !== null ? { loadTimeMs } : {}),
      });
      try {
        if (typeof navigator !== "undefined" && navigator.sendBeacon) {
          const blob = new Blob([body], { type: "application/json" });
          navigator.sendBeacon("/api/analytics/pageview", blob);
        } else {
          void fetch("/api/analytics/pageview", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body,
            keepalive: true,
          });
        }
      } catch {
        /* non-fatal */
      }
    };

    if (typeof window !== "undefined" && "requestIdleCallback" in window) {
      const id = window.requestIdleCallback(() => send(), { timeout: 4000 });
      return () => window.cancelIdleCallback(id);
    }
    const t = setTimeout(send, 0);
    return () => clearTimeout(t);
  }, [pathname]);

  return null;
}
