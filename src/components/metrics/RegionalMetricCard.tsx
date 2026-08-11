"use client";

import { useState } from "react";
import Link from "next/link";
import { InfoTooltip } from "@/components/InfoTooltip";
import { scoreMetric, getMetricBadge, getMetricThreshold } from "@/lib/utils/metricScoring";
import { useWorldFlags } from "@/hooks/useWorldFlags";
import { getMetricDefinition } from "@/lib/constants/metricDefinitions";
import { isMetricActive, getEraMetricName } from "@/lib/era/metricCatalog";
import type { MetricCategoryId } from "@/lib/db/types";
import { formatMetricValue } from "./formatMetricValue";
import { scoreColor } from "./scoreColor";
import { ScoreBadge } from "./ScoreBadge";
import { TrendChip } from "./TrendChip";
import { TickChip } from "./TickChip";
import { HealthRing } from "./HealthRing";
import { Sparkline } from "./Sparkline";
import { RegionRankingList } from "./RegionRankingList";
import { ComparisonBar } from "./ComparisonBar";

interface RegionalMetricCardProps {
  category: MetricCategoryId | string;
  metricId: string;
  value: number;
  trend?: number;
  nationalAverage?: number;
  tickRate?: number;
  countryId: string;
  regionId: string;
  regionLabelPlural: string;
  /** National per-region rankings for this metric (powers the "vs other regions" list). */
  rankings?: { stateId: string; stateName: string; value: number; rank: number }[];
  detailHref?: string;
}

/** Regional metric card: value + score/trend/tick + vs-national comparison bar,
 *  expandable to thresholds, a trend sparkline, and rank-within-regions. */
export function RegionalMetricCard({
  category,
  metricId,
  value,
  trend,
  nationalAverage,
  tickRate,
  countryId,
  regionId,
  regionLabelPlural,
  rankings,
  detailHref,
}: RegionalMetricCardProps) {
  const [open, setOpen] = useState(false);
  const { preset, eraSystemEnabled, currentYear, startingYear, incomeBandIndexByCountry } =
    useWorldFlags();
  // Live year for era-aware score bands; null while the flag is off (legacy path).
  const eraYear = eraSystemEnabled ? currentYear : null;
  const incomeIndex = eraYear != null ? (incomeBandIndexByCountry?.[countryId] ?? null) : null;
  const def = getMetricDefinition(category as MetricCategoryId, metricId);
  const name = def ? getEraMetricName(def, eraYear, regionId) : metricId;
  const isHigherBetter = def?.isHigherBetter ?? true;
  const score = scoreMetric(metricId, value, countryId, preset, eraYear, incomeIndex, startingYear);
  const badge = score !== null ? getMetricBadge(score) : null;
  // Era existence gate: a metric outside its era window renders nothing at all
  // (self-hiding card — every parent list is covered without per-parent filters).
  if (!isMetricActive(metricId, countryId, eraYear)) return null;
  const fmt = (v: number) =>
    def ? formatMetricValue(def, v, countryId) : v.toLocaleString("en-US");
  const threshold = getMetricThreshold(
    metricId,
    countryId,
    preset,
    eraYear,
    incomeIndex,
    startingYear
  );

  const hasNatAvg = nationalAverage !== undefined && nationalAverage !== null;
  const diffPct =
    hasNatAvg && nationalAverage !== 0 ? ((value - nationalAverage) / nationalAverage) * 100 : null;
  const diffGood = diffPct != null && (isHigherBetter ? diffPct > 0 : diffPct < 0);

  const decimals = def?.decimals ?? 1;
  const ranked = (rankings ?? []).map((r) => ({
    regionId: r.stateId,
    regionName: r.stateName,
    value: r.value,
    rank: r.rank,
  }));
  const myRankIndex = ranked.findIndex((r) => r.regionId === regionId);

  // Deterministic mini-history for the sparkline (from value + trend).
  const t = trend ?? 0;
  const hist: number[] = [];
  let histV = value * (1 - (t / 100) * 1.1);
  for (let i = 0; i < 12; i++) {
    histV += ((value - histV) / (12 - i)) * (0.7 + 0.3 * Math.sin(i));
    hist.push(+histV.toFixed(decimals));
  }
  hist.push(value);

  return (
    <div
      className={`rounded-xl border bg-card transition-colors ${open ? "border-primary/40" : "border-card-border"}`}
    >
      <button onClick={() => setOpen((o) => !o)} className="w-full p-4 text-left">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <h3 className="truncate text-[13px] font-semibold text-foreground">{name}</h3>
              {def?.description && (
                <InfoTooltip
                  trigger={
                    <span className="cursor-default select-none text-[13px] leading-none text-muted/50 hover:text-muted">
                      ⓘ
                    </span>
                  }
                  width={240}
                >
                  <p className="mb-1 font-semibold text-foreground">{name}</p>
                  <p className="leading-relaxed text-muted">{def.description}</p>
                  <p className="mt-1 text-muted">
                    {isHigherBetter ? "↑ Higher is better" : "↓ Lower is better"}
                  </p>
                </InfoTooltip>
              )}
            </div>
            <div className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <span className="text-2xl font-bold tabular-nums text-foreground">{fmt(value)}</span>
              <TrendChip trend={trend} isHigherBetter={isHigherBetter} />
              {diffPct != null && Math.abs(diffPct) >= 0.05 && (
                <span
                  className={`whitespace-nowrap text-[11px] font-medium tabular-nums ${
                    Math.abs(diffPct) < 2 ? "text-muted" : diffGood ? "text-success" : "text-error"
                  }`}
                >
                  {diffPct >= 0 ? "+" : ""}
                  {diffPct.toFixed(1)}% vs nat&apos;l
                </span>
              )}
            </div>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1.5">
            {score !== null && badge && <ScoreBadge score={score} label={badge.label} />}
            {def && (
              <TickChip tick={tickRate} isHigherBetter={isHigherBetter} suffix={def.formatSuffix} />
            )}
          </div>
        </div>

        {/* vs national comparison bar */}
        {hasNatAvg && (
          <div className="mt-3">
            <ComparisonBar value={value} avg={nationalAverage} isHigherBetter={isHigherBetter} />
            <div className="mt-1 flex justify-between text-[10px] text-muted">
              <span>0</span>
              <span>nat&apos;l avg {fmt(nationalAverage)}</span>
              <span>{fmt(nationalAverage * 2)}</span>
            </div>
          </div>
        )}
      </button>

      {open && (
        <div className="border-t border-card-border bg-card-muted p-4">
          <div className="grid gap-4 lg:grid-cols-2">
            {/* score + thresholds + trend */}
            <div className="rounded-lg border border-card-border bg-card p-3.5">
              <div className="flex items-center gap-3">
                {score !== null && <HealthRing score={score} size={58} label="/100" />}
                <div className="min-w-0 flex-1">
                  <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted">
                    Quality score
                  </div>
                  <div className="mt-1 text-[12px] text-foreground">
                    {isHigherBetter ? "↑ Higher is better" : "↓ Lower is better"}
                  </div>
                  {threshold && (
                    <div className="mt-2 grid grid-cols-2 gap-2 text-[11px]">
                      <div className="rounded bg-card-muted px-2 py-1">
                        <div className="text-muted">Target</div>
                        <div className="font-bold tabular-nums text-success">
                          {fmt(threshold.best)}
                        </div>
                      </div>
                      <div className="rounded bg-card-muted px-2 py-1">
                        <div className="text-muted">Worst</div>
                        <div className="font-bold tabular-nums text-error">
                          {fmt(threshold.worst)}
                        </div>
                      </div>
                    </div>
                  )}
                  {threshold && (
                    <div className="mt-1.5 text-[10px] leading-snug text-muted">
                      {fmt(value)} scored against target {fmt(threshold.best)} / worst{" "}
                      {fmt(threshold.worst)}
                    </div>
                  )}
                </div>
              </div>
              <div className="mt-3 flex items-center justify-between border-t border-card-border pt-3">
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted">
                    Recent trend
                  </div>
                  <div className="mt-0.5">
                    <TrendChip trend={trend} isHigherBetter={isHigherBetter} />
                  </div>
                </div>
                <Sparkline
                  data={hist}
                  w={150}
                  h={40}
                  color={score !== null ? scoreColor(score) : undefined}
                />
              </div>
            </div>

            {/* vs other regions */}
            {ranked.length > 0 ? (
              <div className="rounded-lg border border-card-border bg-card p-3.5">
                <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.16em] text-muted">
                  Versus other {regionLabelPlural}
                </div>
                <RegionRankingList
                  ranked={ranked}
                  picked={regionId}
                  scoreOf={(v) =>
                    scoreMetric(
                      metricId,
                      v,
                      countryId,
                      preset,
                      eraYear,
                      incomeIndex,
                      startingYear
                    ) ?? 0
                  }
                  fmt={fmt}
                />
                <div className="mt-3 flex items-center justify-between rounded-lg bg-card-muted px-3 py-2 text-[12px]">
                  <span className="text-muted">
                    This {regionLabelPlural.replace(/s$/, "")}&apos;s rank
                  </span>
                  <span className="font-bold tabular-nums text-foreground">
                    #{myRankIndex >= 0 ? myRankIndex + 1 : "—"} of {ranked.length}
                  </span>
                </div>
              </div>
            ) : (
              def?.description && (
                <div className="rounded-lg border border-card-border bg-card p-3.5 text-[11px] leading-snug text-muted">
                  {def.description}
                </div>
              )
            )}
          </div>

          {detailHref && (
            <div className="mt-4 flex justify-end">
              <Link
                href={detailHref}
                className="inline-flex items-center gap-1.5 rounded-lg border border-primary/40 bg-primary/10 px-3 py-1.5 text-[12px] font-semibold text-primary hover:bg-primary/20"
              >
                View full metric page
                <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                  <path
                    fillRule="evenodd"
                    d="M5 10a.75.75 0 01.75-.75h6.638L10.23 7.29a.75.75 0 111.04-1.08l3.5 3.25a.75.75 0 010 1.08l-3.5 3.25a.75.75 0 11-1.04-1.08l2.158-1.96H5.75A.75.75 0 015 10z"
                    clipRule="evenodd"
                  />
                </svg>
              </Link>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default RegionalMetricCard;
