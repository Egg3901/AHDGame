"use client";

import { getTargetableDemographics, getDemographicLabels } from "@/lib/utils/demographicAlignment";
import { STATE_PASSIVE_PS_PER_TURN } from "@/lib/politicalStrength/strengthConstants";
import type { StatePartyData, UserData } from "./types";
import { getTreasuryFlavorText, fmt } from "./helpers";
import { FundraisingTooltip } from "./FundraisingTooltip";

interface TreasuryOverviewSectionProps {
  stateParty: StatePartyData;
  countryId: string;
  user: UserData | null;
  isMember: boolean;
  netIncome: number;
  totalSpending: number;
  revenue: number;
  gotvPct: number;
  supPct: number;
  psPct: number;
  netPct: number;
}

export function TreasuryOverviewSection({
  stateParty,
  countryId,
  user,
  isMember,
  netIncome,
  totalSpending,
  revenue,
  gotvPct,
  supPct,
  psPct,
  netPct,
}: TreasuryOverviewSectionProps) {
  const targetableDemos = getTargetableDemographics(countryId);
  const DEMOGRAPHIC_LABELS = getDemographicLabels(countryId);

  const gotvDemo =
    stateParty.gotvTargetCategory && stateParty.gotvTargetGroup
      ? targetableDemos.find(
          (d) =>
            d.category === stateParty.gotvTargetCategory && d.group === stateParty.gotvTargetGroup
        )
      : null;
  const supDemo =
    stateParty.suppressionTargetCategory && stateParty.suppressionTargetGroup
      ? targetableDemos.find(
          (d) =>
            d.category === stateParty.suppressionTargetCategory &&
            d.group === stateParty.suppressionTargetGroup
        )
      : null;

  return (
    <div className="rounded-xl border border-card-border bg-card overflow-hidden">
      {/* Cash on Hand — hero section */}
      <div className="px-6 py-6 border-b border-card-border/40 bg-background/30">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <svg
                className="h-5 w-5 text-warning"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              <div className="text-xs font-semibold uppercase tracking-wide text-muted">
                Cash on Hand
              </div>
            </div>
            <div className="text-4xl font-bold text-warning tabular-nums">
              {fmt(stateParty.treasury, countryId)}
            </div>
            <p className="text-[11px] text-muted/50 mt-1 max-w-xs">
              {getTreasuryFlavorText(stateParty.treasury, netIncome)}
            </p>
          </div>
          {(isMember || user?.isAdmin) && (
            <div className="text-right shrink-0">
              <div
                className={`text-2xl font-bold tabular-nums ${
                  netIncome >= 0 ? "text-success" : "text-error"
                }`}
              >
                {netIncome >= 0 ? "+" : ""}
                {fmt(netIncome, countryId)}
              </div>
              <div className="text-xs text-muted">net / hr</div>
              {netIncome < 0 && (
                <div className="text-[10px] text-error/60 mt-0.5">
                  Depletes in ~{Math.ceil(stateParty.treasury / Math.abs(netIncome))} hrs
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Budget Breakdown Bar */}
      {(isMember || user?.isAdmin) && revenue > 0 && totalSpending > 0 && (
        <div className="px-6 py-3 border-b border-card-border/40">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-muted mb-1.5">
            Budget Allocation
          </div>
          <div className="flex h-3 rounded-full overflow-hidden bg-background">
            {gotvPct > 0 && (
              <div
                className="bg-primary/70 transition-all"
                style={{ width: `${gotvPct}%` }}
                title={`GOTV: ${gotvPct.toFixed(0)}%`}
              />
            )}
            {supPct > 0 && (
              <div
                className="bg-error/70 transition-all"
                style={{ width: `${supPct}%` }}
                title={`Suppression: ${supPct.toFixed(0)}%`}
              />
            )}
            {psPct > 0 && (
              <div
                className="bg-warning/70 transition-all"
                style={{ width: `${psPct}%` }}
                title={`PS Investment: ${psPct.toFixed(0)}%`}
              />
            )}
            <div
              className="bg-success/40 transition-all"
              style={{ width: `${netPct}%` }}
              title={`Retained: ${netPct.toFixed(0)}%`}
            />
          </div>
          <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-[10px] text-muted">
            {gotvPct > 0 && (
              <span className="flex items-center gap-1">
                <span className="inline-block h-2 w-2 rounded-sm bg-primary/70" />
                GOTV {gotvPct.toFixed(0)}%
              </span>
            )}
            {supPct > 0 && (
              <span className="flex items-center gap-1">
                <span className="inline-block h-2 w-2 rounded-sm bg-error/70" />
                Suppression {supPct.toFixed(0)}%
              </span>
            )}
            {psPct > 0 && (
              <span className="flex items-center gap-1">
                <span className="inline-block h-2 w-2 rounded-sm bg-warning/70" />
                PS Investment {psPct.toFixed(0)}%
              </span>
            )}
            <span className="flex items-center gap-1">
              <span className="inline-block h-2 w-2 rounded-sm bg-success/40" />
              Retained {netPct.toFixed(0)}%
            </span>
          </div>
        </div>
      )}

      {/* Financial Summary */}
      <div className="divide-y divide-card-border/20">
        <div className="px-6 py-3 flex items-center justify-between text-sm">
          <span className="text-muted">
            State tax rate
            <FundraisingTooltip text="The percentage of member income collected by this state party. Set by the state party chair." />
          </span>
          <span className="tabular-nums font-medium">{stateParty.stateTaxRate}%</span>
        </div>
        <div className="px-6 py-3 flex items-center justify-between text-sm">
          <span className="text-muted">
            National tax rate
            <FundraisingTooltip text="The percentage of member income collected by the national party. Set by national party leadership." />
          </span>
          <span className="tabular-nums font-medium">{stateParty.nationalTaxRate}%</span>
        </div>
        <div className="px-6 py-3 flex items-center justify-between text-sm">
          <span className="text-muted">
            Revenue / hr
            <FundraisingTooltip text="Estimated hourly income deposited into this state treasury, based on state members and the state tax rate." />
          </span>
          {isMember || user?.isAdmin ? (
            <span
              className={`tabular-nums font-semibold ${
                stateParty.expectedHourlyIncome >= 0 ? "text-success" : "text-error"
              }`}
            >
              {stateParty.expectedHourlyIncome >= 0 ? "+" : ""}
              {fmt(stateParty.expectedHourlyIncome, countryId)}
            </span>
          ) : (
            <span className="text-muted text-xs">Members only</span>
          )}
        </div>
        <div className="px-6 py-3 flex items-center justify-between text-sm">
          <span className="text-muted">
            GOTV spending / hr
            <FundraisingTooltip text="Amount automatically spent each turn to boost voter turnout among aligned demographics." />
          </span>
          <span className="tabular-nums font-medium text-error">
            {stateParty.gotvBudgetPercent > 0 ? (
              <>
                -{fmt(stateParty.gotvEstimatedSpend, countryId)}
                <span className="text-muted ml-1">({stateParty.gotvBudgetPercent}%)</span>
                {gotvDemo && (
                  <span className="text-muted ml-1 text-xs">
                    · {DEMOGRAPHIC_LABELS[gotvDemo.group] ?? gotvDemo.group}
                  </span>
                )}
              </>
            ) : (
              "None"
            )}
          </span>
        </div>
        {stateParty.suppressionBudgetPercent > 0 && (
          <div className="px-6 py-3 flex items-center justify-between text-sm">
            <span className="text-muted">
              Suppression spending / hr
              <FundraisingTooltip text="Amount automatically spent each turn on voter intimidation / misinformation to reduce opponent turnout." />
            </span>
            <span className="tabular-nums font-medium text-error">
              -{fmt(stateParty.suppressionEstimatedSpend, countryId)}
              <span className="text-muted ml-1">({stateParty.suppressionBudgetPercent}%)</span>
              {supDemo && (
                <span className="text-muted ml-1 text-xs">
                  · {DEMOGRAPHIC_LABELS[supDemo.group] ?? supDemo.group}
                </span>
              )}
            </span>
          </div>
        )}
        {stateParty.psInvestmentBudget > 0 &&
          (() => {
            // $0 while at the PS cap: no headroom to convert treasury into PS, so
            // the budget goes unspent that turn even though it's allocated.
            // Surface that so "-$0" doesn't read as a bug (ticket #905).
            const psSpend = Math.max(
              0,
              revenue -
                stateParty.gotvEstimatedSpend -
                stateParty.suppressionEstimatedSpend -
                netIncome
            );
            const atPsCap =
              stateParty.effectivePsCap != null &&
              stateParty.politicalStrength + STATE_PASSIVE_PS_PER_TURN >= stateParty.effectivePsCap;
            return (
              <div className="px-6 py-3 flex items-center justify-between text-sm">
                <span className="text-muted">
                  PS investment spending / hr
                  <FundraisingTooltip text="Treasury automatically converted each turn to grow state party strength, up to your budget. Nothing is spent while you're at your PS cap — there's no headroom to invest into." />
                </span>
                <span className="tabular-nums font-medium text-error flex items-center gap-1.5">
                  {atPsCap && psSpend <= 0 && (
                    <span className="text-xs font-normal text-muted px-1.5 py-0.5 rounded bg-warning/10 border border-warning/30">
                      at PS cap
                    </span>
                  )}
                  <span>
                    -{fmt(psSpend, countryId)}
                    <span className="text-muted ml-1">
                      ({fmt(stateParty.psInvestmentBudget, countryId)})
                    </span>
                  </span>
                </span>
              </div>
            );
          })()}
        <div className="px-6 py-3.5 flex items-center justify-between text-sm font-semibold bg-background/20">
          <span>
            Net income / hr
            <FundraisingTooltip text="Revenue minus GOTV, suppression, and PS investment spending. The actual amount added to the treasury each turn." />
          </span>
          {isMember || user?.isAdmin ? (
            <span className={`tabular-nums ${netIncome >= 0 ? "text-success" : "text-error"}`}>
              {netIncome >= 0 ? "+" : ""}
              {fmt(netIncome, countryId)} / hr
            </span>
          ) : (
            <span className="text-muted text-xs">Members only</span>
          )}
        </div>
      </div>
    </div>
  );
}
