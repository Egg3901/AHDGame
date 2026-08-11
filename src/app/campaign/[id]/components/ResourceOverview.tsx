"use client";

import { Tooltip } from "@/components/Tooltip";
import { formatCurrencyFaceAmount } from "@/lib/currency/formatCurrencyFaceAmount";
import type { CampaignData } from "@/lib/campaigns/dto/campaignView";

interface ResourceOverviewProps {
  campaign: CampaignData;
}

export function ResourceOverview({ campaign }: ResourceOverviewProps) {
  // Campaign funds / budget are stored in the campaign's local currency, so
  // format the face value directly — do NOT use useCurrency().formatFull, which
  // converts an internal (anchor) amount and would double-convert here.
  const formatFull = (value: number) => formatCurrencyFaceAmount(value, campaign.currencyCode);
  const netIncome = campaign.budget?.netIncome ?? 0;
  // Split sign and absolute value so a negative reads "-$9,500" not "$-9,500".
  const formatSigned = (value: number) => {
    const sign = value >= 0 ? "+" : "-";
    return `${sign}${formatFull(Math.abs(value))}`;
  };
  return (
    <div className="mb-6 grid grid-cols-2 gap-4">
      <div className="rounded-xl border border-card-border bg-card p-5 overflow-hidden">
        <Tooltip
          content={
            <div className="space-y-1.5">
              <p className="font-semibold">Campaign Funds</p>
              <p className="text-muted">Money available for campaign upgrades and operations.</p>
              {campaign.budget && (
                <div className="border-t border-card-border pt-1.5 mt-1 space-y-1">
                  <div className="flex justify-between gap-4">
                    <span className="text-muted">Income/turn</span>
                    <span className="text-success font-mono">
                      +{formatFull(campaign.budget.income.total)}
                    </span>
                  </div>
                  <div className="flex justify-between gap-4">
                    <span className="text-muted">Expenses/turn</span>
                    <span className="text-error font-mono">
                      -{formatFull(campaign.budget.expenses.total)}
                    </span>
                  </div>
                  <div className="flex justify-between gap-4 border-t border-card-border pt-1">
                    <span className="text-muted">Net/turn</span>
                    <span className={`font-mono ${netIncome >= 0 ? "text-success" : "text-error"}`}>
                      {formatSigned(netIncome)}
                    </span>
                  </div>
                </div>
              )}
            </div>
          }
        >
          <div className="text-xs font-medium uppercase tracking-wider text-muted mb-2 cursor-help border-b border-dashed border-card-border/70 inline-block">
            Campaign Funds
          </div>
        </Tooltip>
        <div className="flex flex-col gap-0.5">
          <span className="font-mono text-2xl font-bold text-amber-400 tabular-nums truncate">
            {formatFull(campaign.funds!)}
          </span>
          {campaign.budget && (
            <span className={`font-mono text-xs ${netIncome >= 0 ? "text-success" : "text-error"}`}>
              {formatSigned(netIncome)}/turn
            </span>
          )}
        </div>
      </div>
      <div className="rounded-xl border border-card-border bg-card p-5 overflow-hidden">
        <Tooltip
          content={
            <div className="space-y-1.5">
              <p className="font-semibold">Campaign Actions</p>
              <p className="text-muted">Actions are spent to upgrade campaign operations.</p>
              {campaign.budget?.actions && (
                <div className="border-t border-card-border pt-1.5 mt-1 space-y-1">
                  <div className="flex justify-between gap-4">
                    <span className="text-muted">Net per turn</span>
                    <span
                      className={`font-mono ${
                        campaign.budget.actions.perTurn >= 0 ? "text-cyan-400" : "text-error"
                      }`}
                    >
                      {campaign.budget.actions.perTurn >= 0 ? "+" : ""}
                      {campaign.budget.actions.perTurn}
                    </span>
                  </div>
                  <div className="flex justify-between gap-4">
                    <span className="text-muted">Endorsements</span>
                    <span className="font-mono">{campaign.budget.actions.endorsementCount}</span>
                  </div>
                  {campaign.budget.actions.rallyTourDrain ? (
                    <div className="flex justify-between gap-4">
                      <span className="text-muted">Rally Tour drain</span>
                      <span className="font-mono text-error">
                        −{campaign.budget.actions.rallyTourDrain}
                      </span>
                    </div>
                  ) : null}
                  <p className="text-muted/70 text-[10px] mt-0.5">
                    base {campaign.budget.actions.baseline ?? 0} + floor(sqrt(endorsements) x 3)
                    {campaign.budget.actions.rallyTourDrain ? " − Rally Tour" : ""}
                  </p>
                </div>
              )}
            </div>
          }
        >
          <div className="text-xs font-medium uppercase tracking-wider text-muted mb-2 cursor-help border-b border-dashed border-card-border/70 inline-block">
            Campaign Actions
          </div>
        </Tooltip>
        <div className="flex flex-col gap-0.5">
          <span className="font-mono text-2xl font-bold text-cyan-400 tabular-nums">
            {campaign.actions}
          </span>
          {campaign.budget?.actions && (
            <span
              className={`font-mono text-xs ${
                campaign.budget.actions.perTurn >= 0 ? "text-cyan-400/70" : "text-error/80"
              }`}
            >
              {campaign.budget.actions.perTurn >= 0 ? "+" : ""}
              {campaign.budget.actions.perTurn}/turn ({campaign.budget.actions.endorsementCount}{" "}
              endorsement
              {campaign.budget.actions.endorsementCount !== 1 ? "s" : ""}
              {campaign.budget.actions.rallyTourDrain
                ? `, −${campaign.budget.actions.rallyTourDrain} Rally Tour`
                : ""}
              )
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
