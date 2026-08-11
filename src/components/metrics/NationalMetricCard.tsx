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

interface RegionExtreme {
  value: number;
  stateId: string;
  stateName: string;
}

export interface NationalMetricSummary {
  populationWeightedAverage: number;
  trend?: number;
  min: RegionExtreme;
  max: RegionExtreme;
}

interface NationalMetricCardProps {
  category: MetricCategoryId | string;
  metricId: string;
  summary: NationalMetricSummary;
  rankings: { stateId: string; stateName: string; value: number; rank: number }[];
  tickRate?: number;
  countryId: string;
  regionLabel: string;
  detailHref: string;
}

/** National metric card: headline value + score/trend/tick, expandable to a
 *  drill-down with thresholds, a trend sparkline, and the region ranking list. */
export function NationalMetricCard({
  category,
  metricId,
  summary,
  rankings,
  tickRate,
  countryId,
  regionLabel,
  detailHref,
}: NationalMetricCardProps) {
  const [open, setOpen] = useState(false);
  const { preset, eraSystemEnabled, currentYear, startingYear, incomeBandIndexByCountry } =
    useWorldFlags();
  // Live year for era-aware score bands; null while the flag is off (legacy path).
  const eraYear = eraSystemEnabled ? currentYear : null;
  const incomeIndex = eraYear != null ? (incomeBandIndexByCountry?.[countryId] ?? null) : null;
  const def = getMetricDefinition(category as MetricCategoryId, metricId);
  const name = def ? getEraMetricName(def, eraYear) : metricId;
  const isHigherBetter = def?.isHigherBetter ?? true;
  const value = summary.populationWeightedAverage;
  const score = scoreMetric(metricId, value, countryId, preset, eraYear, incomeIndex, startingYear);
  const badge = score !== null ? getMetricBadge(score) : null;
  // Era existence gate: inactive metrics render nothing (self-hiding card).
  if (!isMetricActive(metricId, countryId, eraYear)) return null;
  const fmt = (v: number) =>
    def ? formatMetricValue(def, v, countryId) : v.toLocaleString("en-US");

  const best = isHigherBetter ? summary.max : summary.min;
  const worst = isHigherBetter ? summary.min : summary.max;
  const threshold = getMetricThreshold(
    metricId,
    countryId,
    preset,
    eraYear,
    incomeIndex,
    startingYear
  );

  const decimals = def?.decimals ?? 1;
  const ranked = rankings.map((r) => ({
    regionId: r.stateId,
    regionName: r.stateName,
    value: r.value,
    rank: r.rank,
  }));

  // Deterministic mini-history for the drill-down sparkline (from value + trend).
  const trend = summary.trend ?? 0;
  const hist: number[] = [];
  let histV = value * (1 - (trend / 100) * 1.1);
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
              <InfoTooltip
                trigger={
                  <span className="cursor-default select-none text-[13px] leading-none text-muted/50 hover:text-muted">
                    ⓘ
                  </span>
                }
                width={260}
              >
                <p className="mb-1 font-semibold text-foreground">{name}</p>
                {def?.description && (
                  <p className="mb-1.5 leading-relaxed text-muted">{def.description}</p>
                )}
                {threshold && (
                  <div className="space-y-0.5 border-t border-card-border/50 pt-1.5">
                    <div className="flex justify-between gap-4">
                      <span className="text-muted">Best (target):</span>
                      <span className="font-medium text-success">{fmt(threshold.best)}</span>
                    </div>
                    <div className="flex justify-between gap-4">
                      <span className="text-muted">Worst:</span>
                      <span className="font-medium text-error">{fmt(threshold.worst)}</span>
                    </div>
                    <div className="flex justify-between gap-4 border-t border-card-border/30 pt-0.5">
                      <span className="text-muted">Direction:</span>
                      <span className="font-medium text-foreground/80">
                        {isHigherBetter ? "↑ Higher is better" : "↓ Lower is better"}
                      </span>
                    </div>
                  </div>
                )}
              </InfoTooltip>
            </div>
            <div className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <span className="text-2xl font-bold tabular-nums text-foreground">{fmt(value)}</span>
              <TrendChip trend={summary.trend} isHigherBetter={isHigherBetter} />
            </div>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1.5">
            {score !== null && badge && <ScoreBadge score={score} label={badge.label} />}
            {def && (
              <TickChip tick={tickRate} isHigherBetter={isHigherBetter} suffix={def.formatSuffix} />
            )}
          </div>
        </div>

        {/* best/worst region row */}
        <div className="mt-3 flex items-center justify-between gap-3 text-[11px]">
          <span className="flex min-w-0 items-center gap-1 text-muted">
            <span className="shrink-0 text-success">▲</span>
            <span className="truncate">{best.stateName}</span>
            <span className="shrink-0">·</span>
            <span className="shrink-0 tabular-nums text-success">{fmt(best.value)}</span>
          </span>
          <span className="flex min-w-0 items-center gap-1 text-muted">
            <span className="shrink-0 text-error">▼</span>
            <span className="truncate">{worst.stateName}</span>
            <span className="shrink-0">·</span>
            <span className="shrink-0 tabular-nums text-error">{fmt(worst.value)}</span>
          </span>
        </div>
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
                    <TrendChip trend={summary.trend} isHigherBetter={isHigherBetter} />
                  </div>
                </div>
                <Sparkline
                  data={hist}
                  w={150}
                  h={40}
                  color={score !== null ? scoreColor(score) : undefined}
                />
              </div>
              {def?.description && (
                <p className="mt-3 text-[11px] leading-snug text-muted">{def.description}</p>
              )}
            </div>

            {/* region rankings */}
            <div className="rounded-lg border border-card-border bg-card p-3.5">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted">
                  {regionLabel} rankings
                </span>
                <span className="text-[10px] text-muted">pop-weighted nat&apos;l {fmt(value)}</span>
              </div>
              <RegionRankingList
                ranked={ranked}
                scoreOf={(v) =>
                  scoreMetric(metricId, v, countryId, preset, eraYear, incomeIndex, startingYear) ??
                  0
                }
                fmt={fmt}
              />
            </div>
          </div>

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
        </div>
      )}
    </div>
  );
}

export default NationalMetricCard;
