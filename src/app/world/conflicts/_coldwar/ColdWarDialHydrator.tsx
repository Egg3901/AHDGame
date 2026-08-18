"use client";

import { useEffect } from "react";
import { writeColdWarDialCache } from "./dialCache";
import type { ColdWarDials } from "@/lib/coldwar/dials";

/**
 * Hydrate the console's localStorage dial cache from the server on load.
 *
 * Mounted once in the Cold War section layout, so every board in the section gets
 * the server's reading whichever route the player enters through. It renders
 * nothing. `writePersistedNumber` dispatches the console's own change event, so
 * boards already on screen re-render through their existing `useSyncExternalStore`
 * subscription with no change to the boards themselves.
 *
 * A failed or slow fetch is deliberately silent: the boards keep whatever the
 * cache last held, which is the pre-existing behaviour rather than a broken page.
 */
export function ColdWarDialHydrator() {
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch("/api/world/conflicts/cold-war/dials", {
          signal: controller.signal,
          cache: "no-store",
        });
        if (!response.ok) return;
        const body = (await response.json()) as { dials?: ColdWarDials };
        if (body.dials) writeColdWarDialCache(body.dials);
      } catch {
        // Aborted or offline. Leave the cache alone.
      }
    })();
    return () => controller.abort();
  }, []);

  return null;
}
