"use client";

import {
  FOREX_CHART_TIMEFRAME_LABELS,
  type ForexChartTimeframe,
} from "@/components/forex/forexChartTimeframe";

interface TimeframeTabsProps {
  value: ForexChartTimeframe;
  onChange: (next: ForexChartTimeframe) => void;
  /** Optional prefix for stable ids when multiple charts on one page */
  idPrefix?: string;
}

export function ForexChartTimeframeTabs({
  value,
  onChange,
  idPrefix = "fx-chart",
}: TimeframeTabsProps) {
  const order: ForexChartTimeframe[] = ["24h", "48h", "5y", "all"];
  return (
    <div
      className="flex flex-wrap gap-1 rounded-lg border border-card-border bg-card-muted p-1"
      role="tablist"
      aria-label="Chart timeframe"
    >
      {order.map((tf) => (
        <button
          key={tf}
          type="button"
          role="tab"
          id={`${idPrefix}-tf-${tf}`}
          aria-selected={value === tf}
          onClick={() => onChange(tf)}
          className={`rounded-md px-2.5 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap ${
            value === tf ? "bg-primary/15 text-primary" : "text-muted hover:text-foreground"
          }`}
        >
          {FOREX_CHART_TIMEFRAME_LABELS[tf]}
        </button>
      ))}
    </div>
  );
}
