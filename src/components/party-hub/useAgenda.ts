"use client";

import { useEffect, useState } from "react";
import { fetchJson } from "@/lib/observability/fetchJson";

interface AgendaPayload {
  agenda: {
    headline: string;
    detail: string;
    setAtTurn: number;
    expiresAtTurn?: number;
  } | null;
}

/**
 * Client hook to fetch the active National Agenda for a party.
 * Returns null while loading and when no agenda is set.
 */
export function useAgenda(countryCode: string | undefined, partyId: string | undefined) {
  const [agenda, setAgenda] = useState<AgendaPayload["agenda"] | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (!countryCode || !partyId) return;
    let alive = true;
    const url = `/api/country/${countryCode.toLowerCase()}/parties/${encodeURIComponent(partyId)}/agenda`;
    fetchJson<AgendaPayload>(url, { feature: "party-agenda" })
      .then((data) => {
        if (!alive) return;
        setAgenda(data.agenda);
      })
      .catch(() => {
        // Silent — banner just doesn't render. Logging via Sentry would be overkill here.
      });
    return () => {
      alive = false;
    };
  }, [countryCode, partyId, refreshKey]);

  return { agenda, refresh: () => setRefreshKey((k) => k + 1) };
}
