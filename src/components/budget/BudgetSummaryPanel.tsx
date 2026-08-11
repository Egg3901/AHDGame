"use client";

export interface BudgetStatItem {
  label: string;
  value: number;
  /** Override colour class for this stat (e.g. "text-success", "text-error") */
  colorClass?: string;
}

export interface BudgetSummaryPanelProps {
  /** Title shown above stats — e.g. "State Budget", "Regional Budget" */
  title: string;
  /** Currency symbol — "$", "£", "€", etc. */
  currencySymbol?: string;
  /** Ordered list of stats to display */
  stats: BudgetStatItem[];
  /** Net balance (revenue - spending). Drives the border colour. */
  balance: number;
  /** Optional warning badge text (e.g. "Over Budget (3 turns)") */
  warningBadge?: string;
}

function formatAmount(amount: number, symbol: string): string {
  const abs = Math.abs(amount);
  const sign = amount < 0 ? "-" : "";
  if (abs >= 1e12) return `${sign}${symbol}${(abs / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${sign}${symbol}${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}${symbol}${(abs / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${sign}${symbol}${(abs / 1e3).toFixed(0)}K`;
  return `${sign}${symbol}${abs.toFixed(0)}`;
}

export function BudgetSummaryPanel({
  title,
  currencySymbol = "$",
  stats,
  balance,
  warningBadge,
}: BudgetSummaryPanelProps) {
  const borderColor = balance < 0 ? "border-error" : "border-success";

  return (
    <div className={`rounded-xl border-2 ${borderColor} bg-card p-5`}>
      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <h3 className="text-base font-semibold text-foreground">{title}</h3>
        {warningBadge && (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-error/40 bg-error/10 px-3 py-1 text-xs font-semibold text-error">
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"
              />
            </svg>
            {warningBadge}
          </span>
        )}
      </div>

      <div className="flex gap-x-6 overflow-x-auto pb-1">
        {stats.map((stat) => (
          <div key={stat.label} className="shrink-0">
            <span className="block text-[10px] uppercase tracking-widest text-muted font-medium mb-0.5 whitespace-nowrap">
              {stat.label}
            </span>
            <span
              className={`text-sm font-bold tabular-nums ${stat.colorClass ?? "text-foreground"}`}
            >
              {stat.colorClass && stat.value >= 0 ? "+" : ""}
              {formatAmount(stat.value, currencySymbol)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
