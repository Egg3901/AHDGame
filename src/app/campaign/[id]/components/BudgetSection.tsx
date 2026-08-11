"use client";

import { Tooltip } from "@/components/Tooltip";
import { formatCurrencyFaceAmount } from "@/lib/currency/formatCurrencyFaceAmount";
import type { CampaignData } from "@/lib/campaigns/dto/campaignView";

interface BudgetSectionProps {
  campaign: CampaignData;
}

export function BudgetSection({ campaign }: BudgetSectionProps) {
  // Budget figures are in the campaign's local currency — format the face value
  // directly; useCurrency().formatFull would convert (anchor→local) and double-count.
  const formatFull = (value: number) => formatCurrencyFaceAmount(value, campaign.currencyCode);
  if (!campaign.budget) return null;
  const netIncome = campaign.budget.netIncome;
  const formatSigned = (value: number) => {
    const sign = value >= 0 ? "+" : "-";
    return `${sign}${formatFull(Math.abs(value))}`;
  };

  return (
    <div className="mb-6 rounded-xl border border-card-border bg-card p-5">
      <h2 className="text-lg font-semibold mb-4">Budget Analysis</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
        {/* Income */}
        <div>
          <div className="text-xs font-medium uppercase tracking-wider text-success mb-3">
            Revenue per Turn
          </div>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between gap-2 font-semibold text-success">
              <Tooltip
                content={`Fundraising level ${campaign.levels.fundraising} generates ${formatFull(campaign.budget.income.total)}/turn. Upgrade Fundraising Operations to increase this.`}
              >
                <span className="cursor-help border-b border-dashed border-success/40">
                  Fundraising Income
                </span>
              </Tooltip>
              <span className="font-mono tabular-nums">
                {formatFull(campaign.budget.income.total)}
              </span>
            </div>
          </div>
        </div>

        {/* Expenses */}
        <div>
          <div className="text-xs font-medium uppercase tracking-wider text-error mb-3">
            Expenses per Turn
          </div>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between gap-2">
              <Tooltip
                content={`Ground Game maintenance at level ${campaign.levels.groundGame}. Maintenance costs accumulate across levels.`}
              >
                <span className="text-muted cursor-help border-b border-dashed border-card-border/70">
                  Ground Game
                </span>
              </Tooltip>
              <span className="font-mono tabular-nums shrink-0">
                {formatFull(campaign.budget.expenses.groundGameMaintenance)}
              </span>
            </div>
            <div className="flex justify-between gap-2">
              <Tooltip
                content={`Media Spending maintenance at level ${campaign.levels.mediaSpending}. Maintenance costs accumulate across levels.`}
              >
                <span className="text-muted cursor-help border-b border-dashed border-card-border/70">
                  Media Spending
                </span>
              </Tooltip>
              <span className="font-mono tabular-nums shrink-0">
                {formatFull(campaign.budget.expenses.mediaSpendingMaintenance)}
              </span>
            </div>
            <div className="border-t border-card-border pt-2 flex justify-between font-semibold text-error">
              <span>Total Expenses</span>
              <span className="font-mono tabular-nums">
                {formatFull(campaign.budget.expenses.total)}
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-4 pt-4 border-t border-card-border">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="flex justify-between items-center">
            <span className="text-sm font-semibold">Net Funds/Turn</span>
            <span
              className={`font-mono text-xl font-bold tabular-nums ${
                netIncome >= 0 ? "text-success" : "text-error"
              }`}
            >
              {formatSigned(netIncome)}
            </span>
          </div>
          <div className="flex justify-between items-center">
            <Tooltip
              content={`Base ${campaign.budget.actions.baseline ?? 0} + ${campaign.budget.actions.endorsementCount} active endorsement${campaign.budget.actions.endorsementCount !== 1 ? "s" : ""} (NPP + player, floor(sqrt(endorsements) x 3) = +${(campaign.budget.actions.grossPerTurn ?? campaign.budget.actions.perTurn) - (campaign.budget.actions.baseline ?? 0)})${campaign.budget.actions.rallyTourDrain ? ` − ${campaign.budget.actions.rallyTourDrain}/turn from your active Rally Tour` : ""}. Net = ${campaign.budget.actions.perTurn}/turn.`}
            >
              <span className="text-sm font-semibold cursor-help border-b border-dashed border-card-border/70">
                Actions/Turn
              </span>
            </Tooltip>
            <span
              className={`font-mono text-xl font-bold tabular-nums ${
                campaign.budget.actions.perTurn >= 0 ? "text-cyan-400" : "text-error"
              }`}
            >
              {campaign.budget.actions.perTurn >= 0 ? "+" : ""}
              {campaign.budget.actions.perTurn}
            </span>
          </div>
        </div>
      </div>

      {/* Cumulative stats */}
      <div className="mt-4 pt-3 border-t border-card-border/50">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center text-xs">
          <Tooltip content="Total funds generated across all turns">
            <div className="cursor-help">
              <div className="text-muted mb-0.5">Total Generated</div>
              <div className="font-mono font-semibold tabular-nums">
                {formatFull(campaign.budget.cumulative.totalGenerated)}
              </div>
            </div>
          </Tooltip>
          <Tooltip content="Total funds spent on upgrades">
            <div className="cursor-help">
              <div className="text-muted mb-0.5">Total Spent</div>
              <div className="font-mono font-semibold tabular-nums">
                {formatFull(campaign.budget.cumulative.totalSpent)}
              </div>
            </div>
          </Tooltip>
          <Tooltip content="Total actions earned across all turns">
            <div className="cursor-help">
              <div className="text-muted mb-0.5">Actions Earned</div>
              <div className="font-mono font-semibold tabular-nums">
                {campaign.budget.cumulative.actionsGenerated}
              </div>
            </div>
          </Tooltip>
          <Tooltip content="Total actions spent on upgrades">
            <div className="cursor-help">
              <div className="text-muted mb-0.5">Actions Spent</div>
              <div className="font-mono font-semibold tabular-nums">
                {campaign.budget.cumulative.actionsSpent}
              </div>
            </div>
          </Tooltip>
        </div>
      </div>
    </div>
  );
}
