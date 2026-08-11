"use client";

import { useEffect, useState } from "react";
import { regionPartyApiUrl } from "@/lib/urls";

export interface PsSpendScope {
  eligibleScopes: { state: boolean; national: boolean } | null;
  poolPS: { statePoolPS: number; nationalPoolPS: number } | null;
}

/**
 * Fetch which PS pools the viewer may spend from for a given (country, state,
 * party). Returns each pool's eligibility and balance; the buttons render one
 * labeled action per eligible pool (a national-tier officer always gets the
 * national pool, a state-tier officer the state pool, a dual-role officer both).
 * Degrades gracefully to nulls on any failure, which the panels treat as the
 * single-button form (server resolves the canonical pool).
 *
 * Pass `enabled = false` to skip the fetch (e.g. unaffiliated viewer).
 */
export function usePsSpendScope(
  countryCode: string,
  stateId: string,
  partyId: string | null,
  enabled: boolean
): PsSpendScope {
  const [eligibleScopes, setEligibleScopes] = useState<PsSpendScope["eligibleScopes"]>(null);
  const [poolPS, setPoolPS] = useState<PsSpendScope["poolPS"]>(null);

  useEffect(() => {
    if (!enabled || !partyId) return;
    let cancelled = false;
    (async () => {
      try {
        const base = regionPartyApiUrl(countryCode, stateId, partyId);
        const r = await fetch(`${base}/ps-spend-scope`);
        const d = await r.json();
        if (cancelled || !d?.ok) return;
        setEligibleScopes(d.eligibleScopes);
        setPoolPS({ statePoolPS: d.statePoolPS, nationalPoolPS: d.nationalPoolPS });
      } catch {
        /* graceful degradation — leaves single-button form */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [countryCode, stateId, partyId, enabled]);

  return { eligibleScopes, poolPS };
}
