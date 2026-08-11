"use client";

/**
 * SP6 — regional statistics in the registry design grammar (playable
 * countries). Replaces the legacy category rings + sub-tabs + card grid on
 * region Metrics tabs with two stacked labeled boards (Economic indicators,
 * Population & demography) of registry rows: score chip · era metric name +
 * vs-national fact · score-toned value with trend · drill-down chevron.
 * Non-playables keep the legacy MetricsCategoryDisplay.
 */

import Link from "next/link";
import { useWorldFlags } from "@/hooks/useWorldFlags";
import { scoreMetric, getMetricBadge } from "@/lib/utils/metricScoring";
import { getMetricDefinition } from "@/lib/constants/metricDefinitions";
import { isMetricActive, getEraMetricName } from "@/lib/era/metricCatalog";
import type { MetricCategoryId } from "@/lib/db/types";
import { regionMetricUrl } from "@/lib/urls";
import { formatMetricValue } from "./formatMetricValue";
import { scoreColor } from "./scoreColor";
import { ScoreBadge } from "./ScoreBadge";
import { TrendChip } from "./TrendChip";

type MetricRecordMap = Record<string, { value: number; trend?: number }> | undefined;

/** Labeled category board in the registry chrome. */
function Board({
  label,
  sub,
  children,
}: {
  label: string;
  sub?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-lg border border-card-border bg-card shadow-panel">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-card-border px-4 py-2.5">
        <h2 className="font-mono text-body-xs font-bold uppercase tracking-widest text-foreground">
          {label}
        </h2>
        {sub ? <span className="font-mono text-body-xs text-muted">{sub}</span> : null}
      </div>
      <div className="flex flex-col gap-2.5 p-4">{children}</div>
    </section>
  );
}

function StatRow({
  category,
  metricId,
  value,
  trend,
  nationalAverage,
  countryId,
  stateId,
}: {
  category: MetricCategoryId;
  metricId: string;
  value: number;
  trend?: number;
  nationalAverage?: number;
  countryId: string;
  stateId: string;
}) {
  const { preset, eraSystemEnabled, currentYear, startingYear, incomeBandIndexByCountry } =
    useWorldFlags();
  // Live year for era-aware score bands; null while the flag is off (legacy path).
  const eraYear = eraSystemEnabled ? currentYear : null;
  const incomeIndex = eraYear != null ? (incomeBandIndexByCountry?.[countryId] ?? null) : null;
  const def = getMetricDefinition(category, metricId);
  // Era existence gate: inactive metrics render nothing (self-hiding row).
  if (!isMetricActive(metricId, countryId, eraYear)) return null;
  const name = def ? getEraMetricName(def, eraYear, stateId) : metricId;
  const isHigherBetter = def?.isHigherBetter ?? true;
  const score = scoreMetric(metricId, value, countryId, preset, eraYear, incomeIndex, startingYear);
  const badge = score !== null ? getMetricBadge(score) : null;
  const fmt = (v: number) => (def ? formatMetricValue(def, v, countryId) : v.toFixed(1));
  const vsNational =
    nationalAverage != null && Number.isFinite(nationalAverage) ? value - nationalAverage : null;
  const vsGood = vsNational != null && (isHigherBetter ? vsNational >= 0 : vsNational <= 0);

  return (
    <Link
      href={regionMetricUrl(countryId, stateId, category, metricId)}
      className="card-hover flex items-center gap-4 rounded-lg border border-card-border bg-card p-4 shadow-card"
    >
      <div className="hidden w-24 flex-shrink-0 text-center sm:block">
        {score !== null && badge ? (
          <ScoreBadge score={score} label={badge.label} />
        ) : (
          <span className="font-mono text-body-xs text-muted">—</span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-body font-semibold leading-snug text-foreground">{name}</div>
        <div className="mt-1.5 flex flex-wrap gap-3 text-body-xs text-muted">
          {nationalAverage != null && Number.isFinite(nationalAverage) ? (
            <span>
              National · {fmt(nationalAverage)}
              {vsNational != null && Math.abs(vsNational) >= 0.05 && (
                <span className={vsGood ? "text-success" : "text-error"} aria-hidden="true">
                  {" "}
                  {vsNational > 0 ? "▲" : "▼"}
                </span>
              )}
            </span>
          ) : (
            <span>regional series</span>
          )}
        </div>
      </div>
      <div className="w-28 flex-shrink-0 text-right">
        <div
          className="text-heading font-extrabold leading-none tabular-nums"
          style={score !== null ? { color: scoreColor(score) } : undefined}
        >
          {fmt(value)}
        </div>
        <div className="mt-1 flex justify-end">
          <TrendChip trend={trend} isHigherBetter={isHigherBetter} />
        </div>
      </div>
      <span className="flex-shrink-0 text-muted" aria-hidden="true">
        ›
      </span>
    </Link>
  );
}

export function RegionalStatBoards({
  countryId,
  stateId,
  economic,
  population,
  nationalAverages,
  economicExtras,
}: {
  countryId: string;
  stateId: string;
  economic: MetricRecordMap;
  population: MetricRecordMap;
  nationalAverages: Record<string, Record<string, number>> | null;
  /** Extra content folded into the top of the Economic board (e.g. GDP decomposition). */
  economicExtras?: React.ReactNode;
}) {
  const rows = (category: MetricCategoryId, records: MetricRecordMap) =>
    Object.entries(records ?? {})
      // Internal simulation values have no metric definition — they are not
      // published statistics, so keep them off the boards.
      .filter(([metricId]) => getMetricDefinition(category, metricId) != null)
      .map(([metricId, record]) => (
        <StatRow
          key={metricId}
          category={category}
          metricId={metricId}
          value={record.value}
          trend={record.trend}
          nationalAverage={nationalAverages?.[category]?.[metricId]}
          countryId={countryId}
          stateId={stateId}
        />
      ));

  return (
    <div className="space-y-6">
      <Board label="Economic indicators" sub="regional series · vs national average">
        {economicExtras}
        {rows("economic", economic)}
      </Board>
      <Board label="Population & demography" sub="regional series">
        {rows("population", population)}
      </Board>
    </div>
  );
}

export default RegionalStatBoards;
