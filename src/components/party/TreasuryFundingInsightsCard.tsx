"use client";

import Link from "next/link";
import type { TreasuryStateFundingMetric } from "@/lib/treasury/partyTreasuryInsights";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { formatCurrency } from "@/lib/utils/formatters";

interface MetricListProps {
  title: string;
  description: string;
  items: TreasuryStateFundingMetric[];
  currencyCode: CurrencyCode;
  valueLabel: (item: TreasuryStateFundingMetric) => string;
}

function MetricList({ title, description, items, currencyCode, valueLabel }: MetricListProps) {
  return (
    <div className="rounded-lg border border-card-border bg-background/40 p-4">
      <div className="mb-3">
        <div className="text-sm font-semibold text-foreground">{title}</div>
        <p className="mt-1 text-xs text-muted">{description}</p>
      </div>
      {items.length === 0 ? (
        <div className="text-xs text-muted">Nothing notable right now.</div>
      ) : (
        <div className="space-y-2">
          {items.map((item) => (
            <Link
              key={`${title}-${item.stateId}`}
              href={item.href}
              className="flex items-start justify-between gap-3 rounded-lg border border-card-border/70 bg-card px-3 py-2 transition-colors hover:border-primary/40"
            >
              <div className="min-w-0">
                <div className="text-sm font-semibold text-foreground">{item.stateName}</div>
                <div className="mt-1 text-[11px] text-muted">
                  Treasury {formatCurrency(item.treasury, currencyCode)} • Org{" "}
                  {item.organization.toFixed(1)}
                </div>
              </div>
              <div className="shrink-0 text-right">
                <div className="text-sm font-semibold text-foreground">{valueLabel(item)}</div>
                <div className="mt-1 text-[11px] text-muted">
                  Growth {item.growthPerTurn >= 0 ? "+" : ""}
                  {item.growthPerTurn.toFixed(1)}/turn
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

interface TreasuryFundingInsightsCardProps {
  currencyCode: CurrencyCode;
  recentTransferRecipients: TreasuryStateFundingMetric[];
  lowestTreasuryStates: TreasuryStateFundingMetric[];
  growthLeaders: TreasuryStateFundingMetric[];
}

export function TreasuryFundingInsightsCard({
  currencyCode,
  recentTransferRecipients,
  lowestTreasuryStates,
  growthLeaders,
}: TreasuryFundingInsightsCardProps) {
  return (
    <div className="rounded-xl border border-card-border bg-card p-5 space-y-4">
      <div>
        <div className="text-xs font-semibold uppercase tracking-wide text-muted">
          State Funding Visibility
        </div>
        <h3 className="mt-1 text-heading-sm font-bold text-foreground">
          Where Money Is Going and Where It Should Go
        </h3>
        <p className="mt-2 text-sm text-muted">
          These national Treasury cards highlight recent transfer recipients, low-cash state
          parties, and the strongest organization growth right now.
        </p>
      </div>
      <div className="grid gap-4 xl:grid-cols-3">
        <MetricList
          title="Recent Transfer Recipients"
          description="States that have taken the most recent national treasury support."
          items={recentTransferRecipients}
          currencyCode={currencyCode}
          valueLabel={(item) => formatCurrency(item.recentTransferAmount, currencyCode)}
        />
        <MetricList
          title="Lowest Treasury States"
          description="The most cash-starved state parties right now."
          items={lowestTreasuryStates}
          currencyCode={currencyCode}
          valueLabel={(item) => formatCurrency(item.treasury, currencyCode)}
        />
        <MetricList
          title="Growth Leaders"
          description="State parties generating the strongest organization growth per turn."
          items={growthLeaders}
          currencyCode={currencyCode}
          valueLabel={(item) =>
            `${item.growthPerTurn >= 0 ? "+" : ""}${item.growthPerTurn.toFixed(1)}/turn`
          }
        />
      </div>
    </div>
  );
}
