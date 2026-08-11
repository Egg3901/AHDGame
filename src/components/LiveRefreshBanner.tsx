"use client";

import { useCallback, useState } from "react";
import { usePathname } from "next/navigation";
import { useGameEvents } from "@/hooks/useGameEvents";
import { isLightweightLayoutPath } from "@/lib/constants/layoutPaths";

const EXCLUDED_PATHS = ["/", "/login", "/register", "/banned", "/maintenance"];

/**
 * Displays a non-intrusive banner when a new turn has been processed,
 * prompting the user to refresh for updated data.
 */
export function LiveRefreshBanner() {
  const pathname = usePathname();
  const isExcludedPath = EXCLUDED_PATHS.includes(pathname) || isLightweightLayoutPath(pathname);
  // Store pathname along with turnReady state to auto-reset on navigation
  const [state, setState] = useState<{ pathname: string; ready: boolean }>({
    pathname,
    ready: false,
  });

  useGameEvents(
    useCallback(() => {
      setState((prev) => ({ ...prev, ready: true }));
    }, []),
    ["turn_complete"],
    !isExcludedPath
  );

  // Update pathname in state when route changes (resets ready to false)
  if (state.pathname !== pathname) {
    setState({ pathname, ready: false });
  }

  if (isExcludedPath || !state.ready) return null;

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 animate-in slide-in-from-bottom-4 fade-in duration-300">
      <button
        onClick={() => window.location.reload()}
        className="flex items-center gap-2 rounded-full border border-primary/30 bg-card px-5 py-2.5 text-sm font-medium text-foreground shadow-lg backdrop-blur-sm transition-all hover:border-primary/60 hover:shadow-xl"
      >
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
        </span>
        New turn processed — click to refresh
      </button>
    </div>
  );
}
