"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { usePathname } from "next/navigation";

type FlairMode = "indeterminate" | "fill" | "fill-fadeout" | "idle";

function isModifiedClick(e: PointerEvent) {
  return e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0;
}

function shouldStartSpaBar(anchor: HTMLAnchorElement): boolean {
  if (anchor.target === "_blank" || anchor.hasAttribute("download")) return false;
  if (anchor.getAttribute("data-skip-nav-flair") != null) return false;
  try {
    const url = new URL(anchor.href, window.location.href);
    if (url.origin !== window.location.origin) return false;
    const next = `${url.pathname}${url.search}`;
    const cur = `${window.location.pathname}${window.location.search}`;
    return next !== cur;
  } catch {
    return false;
  }
}

/**
 * Fixed accent strip: theme tokens via CSS (mix with --background, never `transparent`
 * in color-mix — that can wash out to invisible in sRGB). Indeterminate during client-nav
 * boot or in-flight SPA navigation, then fill → idle.
 */
export function NavbarTopFlair({ bootLoading }: { bootLoading: boolean }) {
  const pathname = usePathname();

  const [mode, setMode] = useState<FlairMode>(() => (bootLoading ? "indeterminate" : "idle"));
  const [fillId, setFillId] = useState(0);

  const pathnamePrev = useRef<string | null>(null);
  const spaAwaitingRoute = useRef(false);
  const prevBootLoading = useRef(bootLoading);

  const startFill = useCallback(() => {
    setFillId((n) => n + 1);
    setMode("fill");
  }, []);

  useEffect(() => {
    if (bootLoading) {
      requestAnimationFrame(() => setMode("indeterminate"));
    } else if (prevBootLoading.current) {
      requestAnimationFrame(() => startFill());
    }
    prevBootLoading.current = bootLoading;
  }, [bootLoading, startFill]);

  useEffect(() => {
    if (pathnamePrev.current === null) {
      pathnamePrev.current = pathname;
      return;
    }
    if (pathnamePrev.current === pathname) return;
    pathnamePrev.current = pathname;

    if (spaAwaitingRoute.current) {
      spaAwaitingRoute.current = false;
      requestAnimationFrame(() => startFill());
    }
  }, [pathname, startFill]);

  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      if (isModifiedClick(e)) return;
      const el = (e.target as HTMLElement | null)?.closest?.("a[href]");
      if (!el) return;
      const a = el as HTMLAnchorElement;
      if (!shouldStartSpaBar(a)) return;
      spaAwaitingRoute.current = true;
      setMode("indeterminate");
    };

    const onPopState = () => {
      spaAwaitingRoute.current = true;
      setMode("indeterminate");
    };

    document.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("popstate", onPopState);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("popstate", onPopState);
    };
  }, []);

  useEffect(() => {
    if (mode !== "indeterminate" || !spaAwaitingRoute.current) return;
    const t = window.setTimeout(() => {
      if (!spaAwaitingRoute.current) return;
      spaAwaitingRoute.current = false;
      setMode("idle");
    }, 14_000);
    return () => window.clearTimeout(t);
  }, [mode, pathname]);

  return (
    <div
      className="pointer-events-none fixed inset-x-0 top-0 z-[100] h-[4px] overflow-hidden"
      aria-hidden
    >
      {/* Always-present idle base — overlays render on top, revealing this underneath */}
      <div className="ahd-nav-flair-idle absolute inset-0" />

      {mode === "indeterminate" && (
        <div className="ahd-nav-flair-track absolute inset-0 overflow-hidden">
          <div className="ahd-nav-flair-shimmer ahd-nav-flair-sweep" />
          <div className="ahd-nav-flair-shimmer ahd-nav-flair-shimmer-alt ahd-nav-flair-sweep" />
        </div>
      )}

      {(mode === "fill" || mode === "fill-fadeout") && (
        <div
          key={fillId}
          className={`absolute inset-0 ahd-nav-flair-fill-layer ${
            mode === "fill" ? "ahd-nav-flair-fill-once" : "ahd-nav-flair-fill-fadeout"
          }`}
          style={{ transformOrigin: "0 50%" }}
          onAnimationEnd={() => {
            if (mode === "fill") setMode("fill-fadeout");
            else setMode("idle");
          }}
        />
      )}
    </div>
  );
}
