"use client";

import { useState, useEffect, useCallback } from "react";
import type { VpActionDef } from "@/lib/constants/vicePresidentActions";

export interface VpOfficeHolder {
  id: string;
  characterId: string;
  sequentialId?: number;
  characterName: string;
  party?: string;
  partyName?: string;
  partyColor?: string;
  avatarUrl?: string;
  isNPP: boolean;
  administrationStartDate: string | null;
}

export interface VicePresidentOfficeData {
  countryId: string;
  president: VpOfficeHolder | null;
  vicePresident: VpOfficeHolder | null;
  isVicePresident: boolean;
  vpActionsRemaining: number;
  actionCap: number;
  resetHint: string;
  actions: VpActionDef[];
}

export function useVicePresidentOffice(countryCode: string) {
  const [data, setData] = useState<VicePresidentOfficeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/country/${countryCode}/executive/vice-president`);
      if (!res.ok) {
        const json = await res.json();
        setError((json as { error?: string }).error ?? "Failed to load office data");
        return;
      }
      setData((await res.json()) as VicePresidentOfficeData);
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
