"use client";

import { useState, useEffect, useCallback } from "react";
import type { JusticeActionDef } from "@/lib/constants/justiceActions";
import type { DivergentDeathChance } from "@/lib/scotus/tenure";

export interface JusticeOfficeSeat {
  seatNumber: number;
  justiceName: string | null;
  justiceParty: string | null;
  economicLean: number | null;
  socialLean: number | null;
  isDivergent: boolean;
  deathChance: DivergentDeathChance | null;
}

export interface JusticeOfficeData {
  countryId: string;
  isJustice: boolean;
  mySeatNumber: number | null;
  seat: JusticeOfficeSeat | null;
  justiceActionsRemaining: number;
  actionCap: number;
  resetHint: string;
  actions: JusticeActionDef[];
}

/** Mirrors `useVicePresidentOffice` — fetches the viewer's Justice office briefing (#3605). */
export function useJusticeOffice(countryCode: string) {
  const [data, setData] = useState<JusticeOfficeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/country/${countryCode}/scotus/justice`);
      if (!res.ok) {
        const json = await res.json();
        setError((json as { error?: string }).error ?? "Failed to load office data");
        return;
      }
      setData((await res.json()) as JusticeOfficeData);
      setError(null);
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }, [countryCode]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return { data, loading, error, refetch: fetchData };
}
