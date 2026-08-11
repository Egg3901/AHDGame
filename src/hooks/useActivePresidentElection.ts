import { useEffect, useState } from "react";
import type { CountryId } from "@/lib/constants/countries";

/**
 * The active/upcoming presidential election for `countryId` (for the nav's
 * "Presidential Election" quick-link), fetched only once `enabled` turns true
 * (the nav opens) — mirroring `useActiveReferendumCampaign`, so closed menus
 * cost nothing and each country's dropdown resolves its OWN race (not a global
 * US one). Returns `null` until resolved or when the country has no live race.
 */
export function useActivePresidentElection(
  countryId: CountryId,
  enabled: boolean
): { id: string; seatId?: string } | null {
  const [election, setElection] = useState<{ id: string; seatId?: string } | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    fetch(`/api/elections/active-president?country=${countryId.toLowerCase()}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled) return;
        setElection(d?.id ? { id: d.id, seatId: d.seatId ?? undefined } : null);
      })
      .catch((err) => {
        // Optional nav affordance — degrade silently but keep the error observable.
        console.debug("active-president election fetch failed", err);
      });
    return () => {
      cancelled = true;
    };
  }, [countryId, enabled]);
  return election;
}
