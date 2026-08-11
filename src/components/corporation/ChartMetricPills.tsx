"use client";

import { NewFeatureBadge } from "@/components/ui";

export interface ChartMetricPill {
  key: string;
  label: string;
  color: string;
}

/**
 * The chart-metric selector pill row. Extracted so the Charts tab renders it
 * identically across its loading / market-share / empty-history / chart states
 * instead of duplicating the markup four ways.
 */
export function ChartMetricPills({
  metrics,
  activeMetric,
  onSelect,
  brandColor,
  newBadgeKey,
  newBadgeVisible,
}: {
  metrics: ReadonlyArray<ChartMetricPill>;
  activeMetric: string;
  onSelect: (key: string) => void;
  brandColor?: string;
  /** Metric key that may show a "New" chip (e.g. marketShare). */
  newBadgeKey?: string;
  /** Whether the new-badge is currently unseen. */
  newBadgeVisible?: boolean;
}) {
  return (
    <div className="rounded-xl border border-card-border bg-card p-4">
      <div className="flex flex-wrap gap-2">
        {metrics.map((metric) => {
          const isActive = activeMetric === metric.key;
          const showNewBadge =
            !!newBadgeKey && metric.key === newBadgeKey && !!newBadgeVisible && !isActive;
          return (
            <button
              key={metric.key}
              onClick={() => onSelect(metric.key)}
              className={`group relative inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-all duration-200 ${
                isActive
                  ? "text-white shadow-lg"
                  : "bg-card-elevated border border-card-border text-muted hover:text-foreground hover:border-card-border/80"
              }`}
              style={isActive ? { backgroundColor: brandColor || metric.color } : undefined}
            >
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: isActive ? "rgba(255,255,255,0.9)" : metric.color }}
              />
              <span className="relative z-10">{metric.label}</span>
              {showNewBadge && <NewFeatureBadge className="ml-0" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}
