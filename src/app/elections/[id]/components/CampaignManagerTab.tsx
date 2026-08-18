"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { formatCurrencyFaceAmount } from "@/lib/currency/formatCurrencyFaceAmount";
import type { CurrencyCode } from "@/lib/constants/currencies";

interface CampaignSummary {
  id: string;
  candidateName: string;
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
  isExact: boolean;
  isMine?: boolean;
  budget?: {
    netIncome: number;
  };
}

interface CampaignManagerTabProps {
  electionId: string;
}

export function CampaignManagerTab({ electionId }: CampaignManagerTabProps) {
  const [campaign, setCampaign] = useState<CampaignSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchCampaign() {
      try {
        setLoading(true);
        const res = await fetch(`/api/elections/${electionId}/campaigns`);
        if (!res.ok) {
          setCampaign(null);
          return;
        }

        const data = await res.json();
        const myCampaign = data.campaigns?.find((c: CampaignSummary) => c.isMine === true) ?? null;
        setCampaign(myCampaign);
      } catch (error) {
        console.error("Failed to fetch campaign:", error);
        setCampaign(null);
      } finally {
        setLoading(false);
      }
    }

    fetchCampaign();
  }, [electionId]);

  if (loading) {
    return (
      <div className="rounded-xl border border-card-border bg-card p-6">
        <div className="text-muted text-sm animate-pulse">Loading campaign...</div>
      </div>
    );
  }

  if (!campaign) {
    return null;
  }

  const totalLevels = Object.values(campaign.levels).reduce((a, b) => a + b, 0);
  const partyLabel = campaign.partyName ?? campaign.party;

  return (
    <div className="rounded-xl border border-primary/20 bg-card p-5">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h3 className="text-lg font-semibold">Your Campaign</h3>
          <p className="truncate text-sm text-muted">
            {campaign.candidateName}
            {partyLabel ? ` - ${partyLabel}` : ""}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Link
            href="#state-org"
            className="inline-flex items-center justify-center rounded-lg border border-primary/40 px-4 py-2 text-sm font-semibold text-primary transition-colors hover:bg-primary/10"
          >
            State Organization
          </Link>
          <Link
            href={`/campaign/${campaign.id}`}
            className="inline-flex items-center justify-center rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary/90"
          >
            Manage Campaign
          </Link>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-card-border bg-background p-3 text-center">
          <div className="text-xs text-muted mb-1">Funds</div>
          <div className="font-mono font-bold text-amber-400 tabular-nums">
            {formatCurrencyFaceAmount(campaign.funds ?? 0, campaign.currencyCode)}
          </div>
          {campaign.budget && (
            <div
              className={`font-mono text-xs mt-0.5 ${
                campaign.budget.netIncome >= 0 ? "text-success/70" : "text-error/70"
              }`}
            >
              {campaign.budget.netIncome >= 0 ? "+" : "-"}
              {formatCurrencyFaceAmount(Math.abs(campaign.budget.netIncome), campaign.currencyCode)}
              /t
            </div>
          )}
        </div>
        <div className="rounded-lg border border-card-border bg-background p-3 text-center">
          <div className="text-xs text-muted mb-1">Actions</div>
          <div className="font-mono font-bold text-cyan-400 tabular-nums">
            {campaign.actions ?? 0}
          </div>
        </div>
        <div className="rounded-lg border border-card-border bg-background p-3 text-center">
          <div className="text-xs text-muted mb-1">Total Levels</div>
          <div className="font-mono font-bold text-purple-400 tabular-nums">{totalLevels}</div>
        </div>
      </div>
    </div>
  );
}
