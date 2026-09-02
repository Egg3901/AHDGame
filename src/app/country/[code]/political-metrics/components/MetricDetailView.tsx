"use client";

import { Button } from "@/components/ui/Button";
import type { PMRegistryData } from "./registryTypes";
import type { PMCategory } from "./CategoryCard";
import { HistorySparkline } from "./HistorySparkline";
import { LeanChip } from "./LeanChip";
import { ModifiersPanel } from "./ModifiersPanel";
import { RegionBreakdown } from "./RegionBreakdown";
import { RelevantLegislationPanel } from "./RelevantLegislationPanel";
import { StatusBadge } from "./StatusBadge";
import { scoreTone } from "./tones";
import { getCurrencyPrefix } from "@/lib/utils/budgetCalculations";

type PMMetric = PMCategory["metrics"][number];

/** SP6: format an evidence row (a "$" prefix becomes the country currency). */
function formatEvidenceValue(
  row: { value: number; format: { prefix?: string; suffix?: string; decimals?: number } },
  countryId: string
): string {
  const decimals = row.format.decimals ?? 1;
  const prefix =
    row.format.prefix === "$" ? getCurrencyPrefix(countryId) : (row.format.prefix ?? "");
  return `${prefix}${row.value.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}${row.format.suffix ?? ""}`;
}

export function MetricDetailView({
  data,
  category,
  metric,
  onBackToCategory,
  onOpenMetric,
}: {
  data: PMRegistryData;
  category: PMCategory;
  metric: PMMetric;
  onBackToCategory: () => void;
  onOpenMetric: (metricId: string) => void;
}) {
  const tone = scoreTone(metric.value);
  const related = category.metrics.filter((m) => m.id !== metric.id);
  return (
    <section className="mt-4 flex flex-col gap-4">
      <div>
        <Button variant="ghost" size="sm" onClick={onBackToCategory}>
          ← {category.displayName}
        </Button>
      </div>

      <div className="rounded-lg border border-card-border bg-card p-4 shadow-card">
        <div className="flex flex-wrap items-start gap-4">
          <div className="min-w-[260px] flex-1">
            <div className="font-mono text-body-xs uppercase tracking-widest text-muted">
              {category.displayName} · {data.countryDisplayName}
            </div>
            <h2 className="mt-1.5 font-display text-heading-lg font-bold leading-tight text-foreground">
              {metric.displayName}
            </h2>
            <p className="mt-2 max-w-[60ch] text-body-sm leading-relaxed text-muted">
              {metric.description}
            </p>
            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              <LeanChip lean={metric.lean} label={metric.leanLabel} />
              <span className="text-body-xs text-muted">association, not a quality judgment</span>
            </div>
          </div>
          <div className="flex items-center gap-5">
            <div className="text-center">
              <div className={`text-display font-extrabold leading-none tabular-nums ${tone.text}`}>
                {Math.round(metric.value)}
              </div>
              <div className="mt-1.5">
                <StatusBadge score={metric.value} label={metric.status} />
              </div>
            </div>
            <div className="flex flex-col gap-1 text-body-sm text-muted">
              <div>
                Trend <span className="italic">series begins this campaign</span>
              </div>
              <div>
                Updated turn{" "}
                <strong className="tabular-nums text-foreground">
                  {data.turn.toLocaleString("en-US")}
                </strong>
              </div>
              <div>
                Scale <strong className="text-foreground">0–100 objective</strong>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-card-border bg-card p-4 shadow-card">
        <div className="mb-2 font-mono text-body-xs uppercase tracking-widest text-muted">
          Historical series
        </div>
        {metric.history.length >= 2 ? (
          <HistorySparkline points={metric.history} />
        ) : (
          <div className="flex h-32 items-center justify-center rounded-md border border-dashed border-card-border bg-card-muted">
            <span className="text-body-sm italic text-muted">series begins this campaign</span>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-card-border bg-card p-4 shadow-card">
          <div className="mb-3 font-mono text-body-xs uppercase tracking-widest text-muted">
            Metric drivers
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <div className="mb-2 text-body-xs font-bold uppercase tracking-wide text-success">
                Positive contributors
              </div>
              <div className="flex flex-col gap-2">
                {metric.pos.map((d) => (
                  <div key={d} className="border-l-2 border-success pl-2.5">
                    <div className="text-body-sm font-semibold text-foreground">{d}</div>
                    <div className="mt-0.5 text-body-xs text-muted">
                      Structural condition · ongoing
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <div className="mb-2 text-body-xs font-bold uppercase tracking-wide text-error">
                Negative contributors
              </div>
              <div className="flex flex-col gap-2">
                {metric.neg.map((d) => (
                  <div key={d} className="border-l-2 border-error pl-2.5">
                    <div className="text-body-sm font-semibold text-foreground">{d}</div>
                    <div className="mt-0.5 text-body-xs text-muted">
                      Structural condition · ongoing
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-card-border bg-card p-4 shadow-card">
          <div className="mb-3 font-mono text-body-xs uppercase tracking-widest text-muted">
            Component indicators
          </div>
          <div className="flex flex-col gap-1.5">
            {metric.indicators.map((ind) => (
              <div key={ind} className="flex items-center gap-2 text-body-sm text-foreground">
                <span className="text-muted">▪</span> {ind}
              </div>
            ))}
          </div>
          <div className="mt-3 border-t border-dashed border-card-border pt-2.5 text-body-xs leading-normal text-muted">
            The headline metric is permanent; its component indicators shift with the era. Indicator
            readings arrive with the registry&apos;s live series.
          </div>
        </div>
      </div>

      <RegionBreakdown nationalValue={metric.national ?? metric.value} regions={metric.regions} />

      <ModifiersPanel modifiers={metric.modifiers} />

      {metric.evidence.length > 0 && (
        <div className="rounded-lg border border-card-border bg-card p-4 shadow-card">
          <div className="mb-2.5 font-mono text-body-xs uppercase tracking-widest text-muted">
            Underlying statistics
          </div>
          <div className="flex flex-col gap-1.5">
            {metric.evidence.map((row) => (
              <div key={row.id} className="flex items-baseline justify-between gap-3 text-body-sm">
                <span className="text-muted">
                  {row.label}
                  {/* In a region view the macro rows are that region's own, but
                      the prime rate, inflation and debt to GDP are set for the
                      whole country. Saying so beats letting a player read a
                      national figure as their region's. */}
                  {data.scope === "region" && row.scope === "national" && (
                    <span className="ml-1.5 rounded border border-card-border px-1 py-0.5 font-mono text-[10px] uppercase tracking-wider text-muted/70">
                      national
                    </span>
                  )}
                </span>
                <span className="font-semibold tabular-nums text-foreground">
                  {formatEvidenceValue(row, data.countryId)}
                  {row.trend != null && Math.abs(row.trend) >= 0.05 && (
                    <span
                      className={`ml-1.5 text-body-xs ${row.trend > 0 ? "text-success" : "text-error"}`}
                    >
                      {row.trend > 0 ? "▲" : "▼"} {Math.abs(row.trend).toFixed(1)}
                    </span>
                  )}
                </span>
              </div>
            ))}
          </div>
          <p className="mt-2.5 text-body-xs leading-normal text-muted">
            National statistical series feeding this judgment. Full series on the Economy page.
          </p>
        </div>
      )}

      <RelevantLegislationPanel countryId={data.countryId} legislation={metric.legislation} />

      <div className="flex flex-wrap items-center gap-2.5 rounded-lg border border-card-border bg-card p-4 shadow-card">
        <span className="font-mono text-body-xs uppercase tracking-widest text-muted">
          Related metrics
        </span>
        {related.map((m) => {
          const rTone = scoreTone(m.value);
          return (
            <button
              key={m.id}
              type="button"
              onClick={() => onOpenMetric(m.id)}
              className="cursor-pointer rounded-full border border-card-border bg-card-muted px-3 py-1 text-body-xs text-foreground transition-colors hover:border-muted"
            >
              {m.displayName} ·{" "}
              <strong className={`tabular-nums ${rTone.text}`}>{Math.round(m.value)}</strong>
            </button>
          );
        })}
      </div>
    </section>
  );
}
