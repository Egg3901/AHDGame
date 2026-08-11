"use client";

import { useEffect, useRef, useState } from "react";
import { logError } from "@/lib/utils/errorLog";

export interface ActiveCharter {
  id: string;
  countryId: string;
  proposedName: string;
}

/**
 * Active-charter list for the navbar's conditional /charters entry.
 *
 * `null` = not fetched yet (caller should keep the entry hidden until
 * we know). `[]` = fetched, none active. Non-empty = the viewer is an
 * active founder of one or more charters in pending-signatures or
 * founder-replacement state.
 *
 * Fires once per `enabled=true` transition. Used by both the desktop
 * NationDropdown and the mobile hamburger menu in Navbar so the gated
 * entry stays in sync across breakpoints.
 */
export function useActiveCharters(enabled: boolean): ActiveCharter[] | null {
  const [charters, setCharters] = useState<ActiveCharter[] | null>(null);
  const hasFetched = useRef(false);

  useEffect(() => {
    if (!enabled || hasFetched.current) return;
    hasFetched.current = true;

    Promise.all([
      fetch("/api/charters?me=true&status=pending-signatures").then((r) =>
        r.ok ? r.json() : { charters: [] }
      ),
      fetch("/api/charters?me=true&status=founder-replacement").then((r) =>
        r.ok ? r.json() : { charters: [] }
      ),
    ])
      .then(([pending, replacement]) => {
        const all = [...(pending?.charters ?? []), ...(replacement?.charters ?? [])];
        setCharters(
          all.map((c: ActiveCharter) => ({
            id: c.id,
            countryId: c.countryId,
            proposedName: c.proposedName,
          }))
        );
      })
      .catch((error) => {
        logError(error, {
          component: "useActiveCharters",
          action: "fetch active charters",
        });
      });
  }, [enabled]);

  return charters;
}
