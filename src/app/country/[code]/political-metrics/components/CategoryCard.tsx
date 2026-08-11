"use client";

import type { CountryPoliticalMetricsResponse } from "@/lib/politicalMetrics/queries/countryPoliticalMetrics";
import { CategoryIcon } from "./categoryIcons";
import { LeanStrip } from "./LeanStrip";
import { StatusBadge } from "./StatusBadge";
import { scoreTone } from "./tones";

export type PMCategory = CountryPoliticalMetricsResponse["categories"][number];

const CATEGORY_ICONS: Record<string, string> = {
  economy: "currency",
  education: "cap",
  health: "heart",
  infrastructure: "building",
  order: "scales",
  environment: "globe",
  society: "users",
  governance: "library",
  defense: "shield",
};

export function CategoryCard({
  category,
  onOpenCategory,
  onOpenMetric,
}: {
  category: PMCategory;
  onOpenCategory: (categoryId: string) => void;
  onOpenMetric: (categoryId: string, metricId: string) => void;
}) {
  const tone = scoreTone(category.score);
  const sorted = [...category.metrics].sort((a, b) => b.nationalValue - a.nationalValue);
  const best = sorted[0];
  const worst = sorted[sorted.length - 1];
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`${category.displayName}, score ${Math.round(category.score)}, ${category.status}`}
      onClick={() => onOpenCategory(category.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") onOpenCategory(category.id);
      }}
      className="card-hover flex cursor-pointer flex-col gap-3 rounded-lg border border-card-border bg-card p-4 shadow-card"
    >
      <div className="flex items-center gap-2">
        <span className="text-primary">
          <CategoryIcon icon={CATEGORY_ICONS[category.id] ?? "library"} className="h-4 w-4" />
        </span>
        <h3 className="flex-1 text-body font-semibold leading-tight text-foreground">
          {category.displayName}
        </h3>
        <StatusBadge score={category.score} label={category.status} />
      </div>
      <div className="flex items-end justify-between gap-2">
        <div>
          <span className={`text-heading-lg font-extrabold tabular-nums ${tone.text}`}>
            {Math.round(category.score)}
          </span>
          <span className="text-body-sm text-muted">/100</span>
        </div>
      </div>
      <div className="flex flex-col gap-1 text-body-sm">
        <div className="flex min-w-0 gap-1.5">
          <span className="flex-shrink-0 text-success">▲ best</span>
          <span className="truncate text-foreground">{best.displayName}</span>
          <span className="flex-shrink-0 tabular-nums text-success">
            {Math.round(best.nationalValue)}
          </span>
        </div>
        <div className="flex min-w-0 gap-1.5">
          <span className="flex-shrink-0 text-error">▼ worst</span>
          <span className="truncate text-foreground">{worst.displayName}</span>
          <span className="flex-shrink-0 tabular-nums text-error">
            {Math.round(worst.nationalValue)}
          </span>
        </div>
      </div>
      <div className="flex items-center justify-between gap-2 border-t border-dashed border-card-border pt-2">
        <LeanStrip
          metrics={category.metrics}
          onOpenMetric={(metricId) => onOpenMetric(category.id, metricId)}
        />
        <span className="whitespace-nowrap text-body-xs text-muted">open →</span>
      </div>
    </div>
  );
}
