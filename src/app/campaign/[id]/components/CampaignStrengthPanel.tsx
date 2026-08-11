"use client";

import { useState } from "react";
import {
  CAMPAIGN_STRENGTH_CONTRIBUTION_NPI_MULTIPLIER,
  campaignStrengthContributionActions,
  campaignStrengthContributionCost,
  campaignStrengthBoostPercent,
} from "@/lib/campaigns/campaignStrength";
import { formatCurrencyFaceAmount } from "@/lib/currency/formatCurrencyFaceAmount";
import type { CurrencyCode } from "@/lib/constants/currencies";

interface CampaignStrengthPanelProps {
  campaignId: string;
  campaignStrength: number;
  isEnded: boolean;
  myNationalInfluence: number | null;
  myActions: number | null;
  myFunds: number | null;
  /** Campaign currency + anchor→local rate so the cost preview shows local money. */
  currencyCode: CurrencyCode;
  fxRate: number;
  onContribute: () => void;
}

export function CampaignStrengthPanel({
  campaignId,
  campaignStrength,
  isEnded,
  myNationalInfluence,
  myActions,
  myFunds,
  currencyCode,
  fxRate,
  onContribute,
}: CampaignStrengthPanelProps) {
  const [contributing, setContributing] = useState(false);
  const [error, setError] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);

  const strengthAdded =
    myNationalInfluence != null
      ? myNationalInfluence * CAMPAIGN_STRENGTH_CONTRIBUTION_NPI_MULTIPLIER
      : 0;
  // The strength-cost formula is anchor-based; localize for display + the funds
  // gate so the player only ever sees their local currency.
  const costFundsAnchor = campaignStrengthContributionCost(campaignStrength, strengthAdded);
  const costFunds = Math.round(costFundsAnchor * fxRate);
  const costActions = campaignStrengthContributionActions(strengthAdded);
  const currentMultiplier = campaignStrengthBoostPercent(campaignStrength).toFixed(1);
  const newMultiplier =
    strengthAdded > 0
      ? campaignStrengthBoostPercent(campaignStrength + strengthAdded).toFixed(1)
      : null;

  const canContribute =
    !isEnded &&
    !contributing &&
    myNationalInfluence != null &&
    myNationalInfluence > 0 &&
    myActions != null &&
    myActions >= costActions &&
    myFunds != null &&
    myFunds >= costFunds;

  async function handleContribute() {
    setContributing(true);
    setError("");
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/campaign-strength`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Contribution failed");
        return;
      }
      setConfirmOpen(false);
      onContribute();
    } catch {
      setError("Network error");
    } finally {
      setContributing(false);
    }
  }

  return (
    <div className="rounded-xl border border-card-border bg-card p-5 mb-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Campaign Strength</h3>
          <p className="text-xs text-muted mt-0.5">
            Boosts vote gain in primaries and general elections
          </p>
        </div>
        <div className="text-right">
          <div className="text-2xl font-bold tabular-nums text-primary">
            {campaignStrength.toFixed(0)}
          </div>
          <div className="text-xs text-muted">+{currentMultiplier}% vote boost</div>
        </div>
      </div>

      {!isEnded && (
        <div className="border-t border-card-border pt-4">
          {myNationalInfluence == null ? (
            <p className="text-xs text-muted">Sign in to contribute campaign strength.</p>
          ) : myNationalInfluence === 0 ? (
            <p className="text-xs text-muted">You have no national influence to contribute.</p>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-3 mb-3 text-xs">
                <div className="rounded-lg bg-background p-2.5 text-center">
                  <div className="text-muted mb-1">Strength Added</div>
                  <div className="font-semibold text-foreground">+{strengthAdded.toFixed(1)}</div>
                </div>
                <div className="rounded-lg bg-background p-2.5 text-center">
                  <div className="text-muted mb-1">Cost</div>
                  <div className="font-semibold text-amber-400">
                    {formatCurrencyFaceAmount(costFunds, currencyCode)}
                  </div>
                </div>
                <div className="rounded-lg bg-background p-2.5 text-center">
                  <div className="text-muted mb-1">Cost (Actions)</div>
                  <div className="font-semibold text-cyan-400">{costActions}</div>
                </div>
              </div>
              {newMultiplier && (
                <p className="text-xs text-muted mb-3">
                  Result: <span className="text-primary font-medium">+{newMultiplier}%</span> vote
                  boost (from +{currentMultiplier}%)
                </p>
              )}
              {error && <p className="text-xs text-error mb-2">{error}</p>}
              {!confirmOpen ? (
                <button
                  onClick={() => setConfirmOpen(true)}
                  disabled={!canContribute}
                  className="w-full rounded-lg bg-primary/10 border border-primary/30 px-4 py-2 text-xs font-medium text-primary hover:bg-primary/20 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  Support Campaign
                </button>
              ) : (
                <div className="space-y-2">
                  <p className="text-xs text-muted">
                    Spend{" "}
                    <span className="text-amber-400 font-medium">
                      {formatCurrencyFaceAmount(costFunds, currencyCode)}
                    </span>{" "}
                    and <span className="text-cyan-400 font-medium">{costActions} actions</span> to
                    add{" "}
                    <span className="text-primary font-medium">
                      {strengthAdded.toFixed(1)} strength
                    </span>
                    ?
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={handleContribute}
                      disabled={contributing}
                      className="flex-1 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-white hover:bg-primary/90 disabled:opacity-50 transition-colors"
                    >
                      {contributing ? "Contributing..." : "Confirm"}
                    </button>
                    <button
                      onClick={() => {
                        setConfirmOpen(false);
                        setError("");
                      }}
                      disabled={contributing}
                      className="flex-1 rounded-lg border border-card-border px-3 py-1.5 text-xs font-medium text-muted hover:text-foreground transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
