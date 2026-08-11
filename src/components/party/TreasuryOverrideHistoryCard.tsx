"use client";

import type { TreasuryOverrideHistoryEntry } from "@/lib/treasury/partyTreasuryInsights";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { formatCurrency } from "@/lib/utils/formatters";
import { LocalTime } from "@/components/time/LocalTime";

interface TreasuryOverrideHistoryCardProps {
  title: string;
  description: string;
  currencyCode: CurrencyCode;
  items: TreasuryOverrideHistoryEntry[];
}

export function TreasuryOverrideHistoryCard({
  title,
  description,
  currencyCode,
  items,
}: TreasuryOverrideHistoryCardProps) {
  return (
    <div className="rounded-xl border border-card-border bg-card p-5 space-y-4">
      <div>
        <div className="text-xs font-semibold uppercase tracking-wide text-muted">
          Emergency Override History
        </div>
        <h3 className="mt-1 text-heading-sm font-bold text-foreground">{title}</h3>
        <p className="mt-2 text-sm text-muted">{description}</p>
      </div>
      {items.length === 0 ? (
        <div className="rounded-lg border border-card-border bg-background/40 px-4 py-3 text-sm text-muted">
          No reserve-piercing overrides have been logged recently.
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((item) => (
            <div
              key={item.id}
              className="rounded-lg border border-card-border bg-background/40 px-4 py-3"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-semibold text-foreground">{item.actorLabel}</div>
                {item.amount !== null && (
                  <div className="text-sm font-semibold text-warning">
                    {formatCurrency(item.amount, currencyCode)}
                  </div>
                )}
              </div>
              <div className="mt-1 text-sm text-muted">{item.details}</div>
              <div className="mt-2 text-[11px] text-muted">
                <LocalTime
                  value={item.createdAt}
                  options={{ dateStyle: "medium", timeStyle: "short" }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
