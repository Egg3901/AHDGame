import { getTargetableDemographics, getDemographicLabels } from "@/lib/utils/demographicAlignment";
import { NATIONAL_PASSIVE_PS_PER_TURN } from "@/lib/politicalStrength/strengthConstants";
import type { PartyData } from "./types";
import { Tooltip, fmt } from "./helpers";

interface TreasuryOverviewProps {
  party: PartyData;
  countryId: string;
  isInParty: boolean;
  isAdmin: boolean;
  netIncome: number;
  totalSpending: number;
  revenue: number;
  gotvPct: number;
  supPct: number;
  psPct: number;
  netPct: number;
}

export function TreasuryOverview({
  party,
  countryId,
  isInParty,
  isAdmin,
  netIncome,
  totalSpending,
  revenue,
  gotvPct,
  supPct,
  psPct,
  netPct,
}: TreasuryOverviewProps) {
  const targetableDemos = getTargetableDemographics(countryId);
  const DEMOGRAPHIC_LABELS = getDemographicLabels(countryId);

  const gotvDemo =
    party.gotvTargetCategory && party.gotvTargetGroup
      ? targetableDemos.find(
          (d) => d.category === party.gotvTargetCategory && d.group === party.gotvTargetGroup
        )
      : null;
  const supDemo =
    party.suppressionTargetCategory && party.suppressionTargetGroup
      ? targetableDemos.find(
          (d) =>
            d.category === party.suppressionTargetCategory &&
            d.group === party.suppressionTargetGroup
        )
      : null;

  return (
    <div className="rounded-xl border border-card-border bg-card overflow-hidden shadow-sm">
      {/* Cash on Hand — hero section */}
      <div className="px-6 py-6 border-b border-card-border/60 bg-card-muted/30">
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-6">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-warning/10 text-warning shadow-sm ring-1 ring-warning/20">
                <svg
                  className="h-4 w-4"
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
              </div>
              <div className="text-sm font-bold uppercase tracking-wide text-muted">
                National War Chest
              </div>
            </div>

            <div>
              <div className="text-4xl sm:text-5xl font-bold text-foreground tabular-nums tracking-tight">
                {fmt(party.treasury, party.countryId)}
              </div>
              <p className="text-xs text-muted mt-2 max-w-md leading-relaxed">
                {party.treasury > 100000
                  ? "A formidable war chest. The party can fund operations across all 50 states."
                  : party.treasury > 30000
                    ? "Solid reserves for national operations and targeted state investments."
                    : "The national treasury needs attention. State parties may need to fend for themselves."}
              </p>
            </div>
          </div>

          {(isInParty || isAdmin) && (
            <div className="flex flex-col sm:items-end gap-1 rounded-lg border border-card-border/50 bg-background/50 p-4 min-w-[180px]">
              <span className="text-xs font-medium text-muted uppercase tracking-wider">
                Net Income
              </span>
              <div className="flex items-baseline gap-1.5">
                <span
                  className={`text-2xl font-bold tabular-nums ${netIncome >= 0 ? "text-success" : "text-error"}`}
                >
                  {netIncome >= 0 ? "+" : "-"}
                  {fmt(Math.abs(netIncome), party.countryId)}
                </span>
                <span className="text-xs text-muted font-medium">/ hr</span>
              </div>

              {netIncome < 0 && (
                <div className="mt-2 flex items-center gap-1.5 text-[10px] font-medium text-error bg-error/10 px-2 py-1 rounded-full">
                  <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                  Depletes in ~{Math.ceil(party.treasury / Math.abs(netIncome))} hrs
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Budget Breakdown Bar */}
      {(isInParty || isAdmin) && revenue > 0 && totalSpending > 0 && (
        <div className="px-6 py-4 border-b border-card-border/40 bg-card/50">
          <div className="flex items-center justify-between mb-2">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted">
              Budget Allocation
            </div>
            <div className="text-xs font-medium text-muted tabular-nums">
              Total Revenue: {fmt(revenue, party.countryId)}/hr
            </div>
          </div>

          <div className="flex h-4 rounded-full overflow-hidden bg-card-elevated ring-1 ring-card-border/50">
            {gotvPct > 0 && (
              <div
                className="bg-primary transition-all hover:bg-primary/90"
                style={{ width: `${gotvPct}%` }}
                title={`GOTV: ${gotvPct.toFixed(0)}%`}
              />
            )}
            {supPct > 0 && (
              <div
                className="bg-error transition-all hover:bg-error/90"
                style={{ width: `${supPct}%` }}
                title={`Suppression: ${supPct.toFixed(0)}%`}
              />
            )}
            {psPct > 0 && (
              <div
                className="bg-warning transition-all hover:bg-warning/90"
                style={{ width: `${psPct}%` }}
                title={`PS Investment: ${psPct.toFixed(0)}%`}
              />
            )}
            <div
              className="bg-success/60 transition-all hover:bg-success/70"
              style={{ width: `${netPct}%` }}
              title={`Retained: ${netPct.toFixed(0)}%`}
            />
          </div>

          <div className="mt-3 flex flex-wrap gap-4 text-xs font-medium text-muted">
            {gotvPct > 0 && (
              <span className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-primary/10 text-primary-foreground border border-primary/20">
                <span className="h-2 w-2 rounded-full bg-primary" />
                GOTV {gotvPct.toFixed(0)}%
              </span>
            )}
            {supPct > 0 && (
              <span className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-error/10 text-error border border-error/20">
                <span className="h-2 w-2 rounded-full bg-error" />
                Suppression {supPct.toFixed(0)}%
              </span>
            )}
            {psPct > 0 && (
              <span className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-warning/10 text-warning border border-warning/20">
                <span className="h-2 w-2 rounded-full bg-warning" />
                PS Investment {psPct.toFixed(0)}%
              </span>
            )}
            <span className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-success/10 text-success border border-success/20">
              <span className="h-2 w-2 rounded-full bg-success/60" />
              Retained {netPct.toFixed(0)}%
            </span>
          </div>
        </div>
      )}

      {/* Financial Summary */}
      <div className="divide-y divide-card-border/40">
        <div className="px-6 py-4 flex items-center justify-between text-sm group hover:bg-card-elevated/20 transition-colors">
          <span className="text-foreground font-medium flex items-center gap-2">
            National tax rate
            <Tooltip text="The percentage of each member's hourly income collected by the national party. Set by the party chair." />
          </span>
          <span className="tabular-nums font-bold text-foreground bg-card-elevated px-2 py-0.5 rounded border border-card-border/50">
            {party.nationalTaxRate}%
          </span>
        </div>

        <div className="px-6 py-4 flex items-center justify-between text-sm group hover:bg-card-elevated/20 transition-colors">
          <span className="text-foreground font-medium flex items-center gap-2">
            Revenue / hr
            <Tooltip text="Estimated hourly income deposited into this treasury, based on membership and tax rate." />
          </span>
          {isInParty || isAdmin ? (
            <span
              className={`tabular-nums font-bold ${party.expectedHourlyIncome >= 0 ? "text-success" : "text-error"}`}
            >
              {party.expectedHourlyIncome >= 0 ? "+" : "-"}
              {fmt(Math.abs(party.expectedHourlyIncome), party.countryId)}
            </span>
          ) : (
            <span className="text-muted text-xs italic">Members only</span>
          )}
        </div>

        <div className="px-6 py-4 flex items-center justify-between text-sm group hover:bg-card-elevated/20 transition-colors">
          <span className="text-foreground font-medium flex items-center gap-2">
            GOTV spending / hr
            <Tooltip text="Amount automatically spent each turn to boost voter turnout among aligned demographics." />
          </span>
          <span className="tabular-nums font-medium text-error">
            {party.gotvBudgetPercent > 0 ? (
              <div className="flex items-center gap-2">
                <span>-{fmt(party.gotvEstimatedSpend, party.countryId)}</span>
                <span className="text-xs text-muted px-1.5 py-0.5 rounded bg-card-elevated border border-card-border/50">
                  {party.gotvBudgetPercent}%
                </span>
                {gotvDemo && (
                  <span className="text-xs text-muted hidden sm:inline-block">
                    · {DEMOGRAPHIC_LABELS[gotvDemo.group] ?? gotvDemo.group}
                  </span>
                )}
              </div>
            ) : (
              <span className="text-muted opacity-50">None</span>
            )}
          </span>
        </div>

        {party.suppressionBudgetPercent > 0 && (
          <div className="px-6 py-4 flex items-center justify-between text-sm group hover:bg-card-elevated/20 transition-colors">
            <span className="text-foreground font-medium flex items-center gap-2">
              Suppression spending / hr
              <Tooltip text="Amount automatically spent each turn on voter intimidation / misinformation to reduce opponent turnout." />
            </span>
            <span className="tabular-nums font-medium text-error">
              <div className="flex items-center gap-2">
                <span>-{fmt(party.suppressionEstimatedSpend, party.countryId)}</span>
                <span className="text-xs text-muted px-1.5 py-0.5 rounded bg-card-elevated border border-card-border/50">
                  {party.suppressionBudgetPercent}%
                </span>
                {supDemo && (
                  <span className="text-xs text-muted hidden sm:inline-block">
                    · {DEMOGRAPHIC_LABELS[supDemo.group] ?? supDemo.group}
                  </span>
                )}
              </div>
            </span>
          </div>
        )}

        {party.psInvestmentBudget > 0 &&
          (() => {
            // Realized PS spend, back-derived from the server-computed net income
            // (revenue − GOTV − suppression − PS = netIncome). This is $0 when the
            // party is at its political-strength cap: with no headroom left, the
            // engine can't convert treasury into PS, so the budget goes unspent
            // that turn even though it's still allocated. Surfacing that reason
            // stops the "-$0" reading as a bug (ticket #905).
            const psSpend = Math.max(
              0,
              revenue - party.gotvEstimatedSpend - party.suppressionEstimatedSpend - netIncome
            );
            const atPsCap =
              party.politicalStrength + NATIONAL_PASSIVE_PS_PER_TURN >= party.effectivePsCap;
            return (
              <div className="px-6 py-4 flex items-center justify-between text-sm group hover:bg-card-elevated/20 transition-colors">
                <span className="text-foreground font-medium flex items-center gap-2">
                  PS investment spending / hr
                  <Tooltip text="Treasury automatically converted each turn to grow national party strength, up to your budget. Nothing is spent while you're at your PS cap — there's no headroom to invest into." />
                </span>
                <span className="tabular-nums font-medium text-error">
                  <div className="flex items-center gap-2">
                    {atPsCap && psSpend <= 0 && (
                      <span className="text-xs font-normal text-muted px-1.5 py-0.5 rounded bg-warning/10 border border-warning/30">
                        at PS cap
                      </span>
                    )}
                    <span>-{fmt(psSpend, party.countryId)}</span>
                    <span className="text-xs text-muted px-1.5 py-0.5 rounded bg-card-elevated border border-card-border/50">
                      {fmt(party.psInvestmentBudget, party.countryId)}
                    </span>
                  </div>
                </span>
              </div>
            );
          })()}

        <div className="px-6 py-4 flex items-center justify-between text-sm font-bold bg-card-muted/20">
          <span className="flex items-center gap-2">
            Net income / hr
            <Tooltip text="Revenue minus GOTV, suppression, and PS investment spending. The actual amount added to the treasury each turn." />
          </span>
          {isInParty || isAdmin ? (
            <span className={`tabular-nums ${netIncome >= 0 ? "text-success" : "text-error"}`}>
              {netIncome >= 0 ? "+" : "-"}
              {fmt(Math.abs(netIncome), party.countryId)} / hr
            </span>
          ) : (
            <span className="text-muted text-xs italic">Members only</span>
          )}
        </div>
      </div>
    </div>
  );
}
