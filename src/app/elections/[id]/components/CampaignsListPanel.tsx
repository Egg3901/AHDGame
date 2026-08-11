"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { formatCurrencyFaceAmount } from "@/lib/currency/formatCurrencyFaceAmount";
import type { CurrencyCode } from "@/lib/constants/currencies";

interface CampaignSummary {
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

interface CampaignsListPanelProps {
  electionId: string;
}

export function CampaignsListPanel({ electionId }: CampaignsListPanelProps) {
  const [campaigns, setCampaigns] = useState<CampaignSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchCampaigns() {
      try {
        setLoading(true);
        const res = await fetch(`/api/elections/${electionId}/campaigns`);
        if (res.ok) {
          const data = await res.json();
          setCampaigns(data.campaigns || []);
        } else {
          setCampaigns([]);
        }
      } catch (error) {
        console.error("Failed to fetch campaigns:", error);
        setCampaigns([]);
      } finally {
        setLoading(false);
      }
    }

    fetchCampaigns();
  }, [electionId]);

  if (loading) {
    return (
      <div className="rounded-lg border border-card-border bg-card p-6">
        <div className="text-muted text-sm">Loading campaigns...</div>
      </div>
    );
  }

  if (campaigns.length === 0) {
    return null;
  }

  return (
    <div className="rounded-xl border border-card-border bg-card p-5">
      <h3 className="mb-4 text-lg font-semibold">Campaign Operations</h3>

      <div className="space-y-3">
        {campaigns
          .filter((c) => c.candidateId)
          .map((campaign) => {
            const partyLabel = campaign.partyName ?? campaign.party;
            const totalLevels = campaign.levels
              ? Object.values(campaign.levels).reduce((a, b) => a + b, 0)
              : 0;

            return (
              <div
                key={campaign.id}
                className="grid gap-4 rounded-lg border border-card-border bg-background p-4 transition-colors hover:border-primary/50 lg:grid-cols-[minmax(0,1fr)_auto_auto] lg:items-center"
              >
                <div className="min-w-0">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <Link
                      href={
                        campaign.candidateIsNPP
                          ? `/politicians/npp/${campaign.candidateId}`
                          : `/character/${campaign.candidateId}`
                      }
                      className="truncate font-semibold text-foreground transition-colors hover:text-primary"
                    >
                      {campaign.candidateName || "Unknown Candidate"}
                    </Link>
                    {campaign.isMine && (
                      <span className="rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                        Yours
                      </span>
                    )}
                  </div>
                  <div className="mt-1 truncate text-xs text-muted">
                    {partyLabel}
                    {campaign.managerName && <span> - Manager: {campaign.managerName}</span>}
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2 text-sm sm:flex sm:gap-3">
                  <div className="flex min-w-0 flex-col items-center rounded bg-card px-3 py-2">
                    <span className="text-xs text-muted">Funds</span>
                    <span className="max-w-full truncate font-mono font-semibold text-amber-400">
                      {formatCurrencyFaceAmount(campaign.funds ?? 0, campaign.currencyCode)}
                    </span>
                  </div>
                  <div className="flex min-w-0 flex-col items-center rounded bg-card px-3 py-2">
                    <span className="text-xs text-muted">Actions</span>
                    <span className="font-mono font-semibold text-cyan-400">
                      {campaign.actions ?? 0}
                    </span>
                  </div>
                  <div className="flex min-w-0 flex-col items-center rounded bg-card px-3 py-2">
                    <span className="text-xs text-muted">Levels</span>
                    <span className="font-mono font-semibold text-purple-400">{totalLevels}</span>
                  </div>
                </div>

                <Link
                  href={`/campaign/${campaign.id}`}
                  className="inline-flex items-center justify-center rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary/90"
                >
                  View Campaign
                </Link>
              </div>
            );
          })}
      </div>

      {!campaigns.some((c) => c.isExact) && (
        <div className="mt-4 text-center text-xs text-muted/70">
          Campaign levels are approximate (fog of war)
        </div>
      )}
    </div>
  );
}
