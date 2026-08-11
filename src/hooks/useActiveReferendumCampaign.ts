import { useEffect, useState } from "react";
import type { CountryId } from "@/lib/constants/countries";

/**
 * Whether a referendum is currently campaigning in `countryId`. Fetches the
 * lightweight `/api/country/[code]/referendums/active` gate only once `enabled`
 * turns true (the nav opens), mirroring `useActiveCharters` — so closed menus
 * cost nothing. Returns `false` until resolved.
 */
export function useActiveReferendumCampaign(countryId: CountryId, enabled: boolean): boolean {
  const [active, setActive] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    fetch(`/api/country/${countryId.toLowerCase()}/referendums/active`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled && d) setActive(Boolean(d.hasActiveCampaign));
      })
      .catch((err) => {
        // Optional nav affordance — degrade silently but keep the error observable.
        console.debug("active-referendum campaign fetch failed", err);
      });
    return () => {
      cancelled = true;
    };
  }, [countryId, enabled]);
  return active;
}
