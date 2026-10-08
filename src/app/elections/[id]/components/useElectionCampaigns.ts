"use client";

import { useEffect, useState } from "react";
import type { CurrencyCode } from "@/lib/constants/currencies";

export interface CampaignSummary {
  id: string;
  candidateId: string;
  candidateName: string;
  candidateIsNPP?: boolean;
  party: string;
  partyName?: string;
  currencyCode: CurrencyCode;
  funds: number;
  actions: number;
  levels: {
    fundraising: number;
    oppositionResearch: number;
    groundGame: number;
    mediaSpending: number;
  };
  managerName: string | null;
  isExact: boolean;
  isMine?: boolean;
}

/** Sum of a campaign's four operation levels. */
export function totalCampaignLevels(campaign: CampaignSummary): number {
  return campaign.levels ? Object.values(campaign.levels).reduce((a, b) => a + b, 0) : 0;
}

/**
 * The campaigns running in an election, with the API's fog-of-war applied.
 *
 * Shared by the standalone campaigns panel and the presidential general
 * screen's tickets table. `refreshKey` refetches without flashing the loading
 * state, so a table that is already on screen does not blank on every turn.
 */
export function useElectionCampaigns(
  electionId: string,
  { enabled = true, refreshKey }: { enabled?: boolean; refreshKey?: string | number } = {}
) {
  const [campaigns, setCampaigns] = useState<CampaignSummary[]>([]);
  const [loading, setLoading] = useState(enabled);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    async function fetchCampaigns() {
      try {
        const res = await fetch(`/api/elections/${electionId}/campaigns`);
        if (cancelled) return;
        if (res.ok) {
          const data = await res.json();
          if (!cancelled) setCampaigns(data.campaigns || []);
        } else {
          setCampaigns([]);
        }
      } catch (error) {
        console.error("Failed to fetch campaigns:", error);
        if (!cancelled) setCampaigns([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchCampaigns();
    return () => {
      cancelled = true;
    };
  }, [electionId, enabled, refreshKey]);

  return { campaigns, loading: enabled && loading };
}
