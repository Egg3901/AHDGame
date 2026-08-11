"use client";

import { useEffect, useState, use } from "react";
import type { CSSProperties } from "react";
import Link from "next/link";
import { regionUrl, regionApiSubUrl } from "@/lib/urls";
import { canonicalRegionId } from "@/lib/constants/countries";
import { ALL_METRIC_DEFS, CATEGORY_LABELS, type MetricDetailData } from "./metricDefs";
import { MetricChart } from "./MetricChart";
import { getStatsIdentity } from "@/lib/constants/nationalStatsIdentity";
import { NATIONAL_SCOPE_IDS } from "@/lib/constants/nationalScope";
import { scoreMetric, getMetricBadge } from "@/lib/utils/metricScoring";
import { isMetricActive, getEraMetricName } from "@/lib/era/metricCatalog";
import { useWorldFlags } from "@/hooks/useWorldFlags";
import { scoreColor } from "@/components/metrics/scoreColor";
import { ScoreBadge } from "@/components/metrics/ScoreBadge";

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function MetricDetailPage({
  params,
}: {
  params: Promise<{ code: string; id: string; category: string; metricId: string }>;
}) {
  const { code, id: rawRegionParam, category, metricId } = use(params);
  const regionId = canonicalRegionId(code.toUpperCase(), rawRegionParam);
  const { preset, eraSystemEnabled, currentYear, startingYear, incomeBandIndexByCountry } =
    useWorldFlags();
  // Live year for era-aware score bands; null while the flag is off (legacy path).
  const eraYear = eraSystemEnabled ? currentYear : null;
  const countryId = code.toUpperCase();
  const incomeIndex = eraYear != null ? (incomeBandIndexByCountry?.[countryId] ?? null) : null;
  const stateId = regionId.toUpperCase();
  const regionBase = regionUrl(code, regionId);
  const identity = getStatsIdentity(countryId);
  // National-scope metric detail pages are reached from the national metrics
  // page (/country/[code]/metrics), not a region page — so the "Metrics" crumb
  // and back link must point there. National-scope doc IDs are lowercase
  // (e.g. "cn_national"); the route param arrives upper-cased.
  const isNationalScope = NATIONAL_SCOPE_IDS.has(stateId.toLowerCase());
  const metricsHomeHref = isNationalScope
    ? `/country/${code.toLowerCase()}/metrics`
    : `${regionBase}?tab=metrics`;
  const rootHref = isNationalScope ? `/country/${code.toLowerCase()}` : regionBase;

  const [data, setData] = useState<MetricDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(regionApiSubUrl(countryId, stateId, `metrics/${category}/${metricId}`))
      .then((r) => (r.ok ? r.json() : Promise.reject("not found")))
      .then((json: MetricDetailData) => setData(json))
      .catch(() => setError("Failed to load metric data"))
      .finally(() => setLoading(false));
  }, [countryId, stateId, category, metricId]);

  const baseDef = ALL_METRIC_DEFS[category]?.[metricId];
  // Honour per-region label overrides so the page header shows "Reunification
  // Desire" in NIR while keeping the underlying metricId stable across regions.
  const def = baseDef
    ? {
        ...baseDef,
        // Era-aware label first (O-Levels pre-1988), then per-region override.
        name: getEraMetricName(
          {
            id: metricId,
            name: baseDef.regionDisplayNames?.[stateId] ?? baseDef.name,
          },
          eraYear
        ),
      }
    : baseDef;

  const fmt = (val: number) => {
    if (!def) return String(val);
    const formatted = val.toLocaleString("en-US", {
      minimumFractionDigits: def.decimals ?? 1,
      maximumFractionDigits: def.decimals ?? 1,
    });
    return `${def.formatPrefix ?? ""}${formatted}${def.formatSuffix ?? ""}`;
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  if (error || !data || !def) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="space-y-3 text-center">
          <p className="text-error">{error ?? "Metric not found"}</p>
          <Link href={metricsHomeHref} className="text-sm text-primary hover:underline">
            ← Back to metrics
          </Link>
        </div>
      </div>
    );
  }

  // Era existence gate: direct navigation to a metric outside its era window
  // shows a friendly notice instead of anachronistic data.
  if (!isMetricActive(metricId, countryId, eraYear)) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="space-y-3 text-center">
          <p className="text-muted">Not tracked in this era.</p>
          <Link href={metricsHomeHref} className="text-sm text-primary hover:underline">
            ← Back to metrics
          </Link>
        </div>
      </div>
    );
  }

  const { value, nationalAverage, globalAverage, tickRate, history, stateName, affectingPolicies } =
    data;
  const hasTickRate = tickRate !== undefined && Math.abs(tickRate) > 0.0001;
  const tickIsGood = hasTickRate && (def.isHigherBetter ? tickRate! > 0 : tickRate! < 0);
  const tickAbs = Math.abs(tickRate ?? 0);
  const tickDecimals = tickAbs < 0.1 ? 3 : tickAbs < 1 ? 2 : 1;
  const yearlyChange = hasTickRate ? tickRate! * 48 : 0;
  const projectedYearValue = hasTickRate ? value + yearlyChange : value;

  const comparisonValue = nationalAverage ?? globalAverage;
  const comparisonLabel = nationalAverage !== undefined ? "National Average" : "Global Average";
  const comparisonDiff = comparisonValue !== undefined ? value - comparisonValue : undefined;
  const comparisonPct =
    comparisonDiff !== undefined && comparisonValue
      ? (comparisonDiff / comparisonValue) * 100
      : undefined;
  const isPositiveComparison =
    comparisonDiff !== undefined
      ? def.isHigherBetter
        ? comparisonDiff > 0
        : comparisonDiff < 0
      : undefined;

  const hasHistory = history.length > 0;
  const score = scoreMetric(metricId, value, countryId, preset, eraYear, incomeIndex, startingYear);
  const badge = score !== null ? getMetricBadge(score) : null;

  const accentVars = {
    "--stat": identity.accent.stat,
    "--stat-soft": identity.accent.statSoft,
    "--g0": identity.accent.g0,
    "--g1": identity.accent.g1,
    "--g2": identity.accent.g2,
  } as CSSProperties;
  const mastheadBg =
    "radial-gradient(120% 150% at 0% 0%, color-mix(in srgb, var(--stat-soft) 16%, transparent) 0%, transparent 44%), linear-gradient(135deg, var(--g0) 0%, var(--g1) 52%, var(--g2) 100%)";

  return (
    <div className="min-h-screen bg-background">
      <main className="mx-auto max-w-3xl space-y-6 px-4 py-10">
        {/* Breadcrumb */}
        <nav className="flex flex-wrap items-center gap-2 text-sm text-muted">
          <Link href={rootHref} className="transition-colors hover:text-primary">
            {stateName}
          </Link>
          <span>/</span>
          <Link href={metricsHomeHref} className="transition-colors hover:text-primary">
            Metrics
          </Link>
          <span>/</span>
          <span className="text-muted/70">{CATEGORY_LABELS[category] ?? category}</span>
          <span>/</span>
          <span className="font-medium text-foreground">{def.name}</span>
        </nav>

        {/* Identity header + hero stats */}
        <div
          className="overflow-hidden rounded-2xl border"
          style={{ ...accentVars, borderColor: "color-mix(in srgb, var(--stat) 25%, transparent)" }}
        >
          <div className="px-6 py-5 sm:px-7" style={{ background: mastheadBg }}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div
                  className="text-[10px] font-bold uppercase tracking-[0.16em]"
                  style={{ color: "color-mix(in srgb, var(--stat-soft) 80%, transparent)" }}
                >
                  {CATEGORY_LABELS[category] ?? category} · {stateName} · {countryId}
                </div>
                <h1 className="mt-1 text-2xl font-bold tracking-tight text-white sm:text-3xl">
                  {def.name}
                </h1>
                {def.description && (
                  <p className="mt-1 max-w-2xl text-[13px] text-white/70">{def.description}</p>
                )}
              </div>
              {score !== null && badge && (
                <div className="shrink-0">
                  <ScoreBadge
                    score={score}
                    label={badge.label}
                    className="!px-2 !py-1 !text-[12px]"
                  />
                </div>
              )}
            </div>
          </div>
          <div
            style={{
              height: 2,
              opacity: 0.85,
              background:
                "linear-gradient(90deg, transparent, var(--stat) 16%, var(--stat-soft) 50%, var(--stat) 84%, transparent)",
            }}
          />
          {/* Stats row */}
          <div className="grid grid-cols-1 divide-y divide-card-border bg-card sm:grid-cols-3 sm:divide-x sm:divide-y-0">
            <div className="px-6 py-4">
              <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted">
                Current Value
              </p>
              <p className="mt-1 text-3xl font-bold tabular-nums text-foreground">{fmt(value)}</p>
            </div>
            {comparisonValue !== undefined && (
              <div className="px-6 py-4">
                <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted">
                  {comparisonLabel}
                </p>
                <p className="mt-1 text-3xl font-bold tabular-nums text-muted">
                  {fmt(comparisonValue)}
                </p>
                {comparisonPct !== undefined && (
                  <p
                    className={`mt-1 text-xs font-medium ${
                      isPositiveComparison
                        ? "text-success"
                        : isPositiveComparison === false
                          ? "text-error"
                          : "text-muted"
                    }`}
                  >
                    {comparisonDiff! >= 0 ? "+" : ""}
                    {comparisonPct.toFixed(1)}% vs avg
                  </p>
                )}
              </div>
            )}
            <div className="px-6 py-4">
              <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted">
                Active Policy Effect
              </p>
              {hasTickRate ? (
                <>
                  <p
                    className={`mt-1 text-3xl font-bold tabular-nums ${tickIsGood ? "text-success" : "text-error"}`}
                  >
                    {tickRate! > 0 ? "+" : "−"}
                    {tickAbs.toFixed(tickDecimals)}
                    {def.formatSuffix ?? ""}/turn
                  </p>
                  <p
                    className={`mt-1 text-xs font-medium ${tickIsGood ? "text-success/70" : "text-error/70"}`}
                  >
                    {tickIsGood ? "Improving" : "Worsening"}
                  </p>
                </>
              ) : (
                <>
                  <p className="mt-1 text-3xl font-bold tabular-nums text-muted">Stable</p>
                  <p className="mt-1 text-xs text-muted/60">No direct policy push</p>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Chart */}
        <div className="rounded-2xl border border-card-border bg-card p-6">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold">
              {hasHistory ? "Historical + Projected Trend" : "48-Turn Forward Projection"}
            </h2>
            <div className="flex items-center gap-3 text-xs text-muted">
              {hasHistory && <span>{history.length} turns of history</span>}
              {hasTickRate && (
                <span>
                  In 1yr:{" "}
                  <span className="font-semibold" style={{ color: scoreColor(score ?? 50) }}>
                    {fmt(projectedYearValue)}
                  </span>
                </span>
              )}
            </div>
          </div>
          <div className="rounded-xl border border-card-border/30 bg-background/60 p-3">
            <MetricChart
              history={history}
              currentValue={value}
              tickRate={tickRate ?? 0}
              isHigherBetter={def.isHigherBetter}
              formatSuffix={def.formatSuffix ?? ""}
              decimals={def.decimals ?? 1}
            />
          </div>
          <p className="mt-2 text-center text-[10px] text-muted/50">
            {hasHistory
              ? "Blue = actual recorded values. Dashed = projection assuming current policies unchanged."
              : "No history recorded yet — chart shows forward projection only. History accumulates each game turn."}
          </p>
        </div>

        {/* Trend analysis */}
        {hasTickRate && (
          <div className="space-y-4 rounded-2xl border border-card-border bg-card p-6">
            <h2 className="text-sm font-semibold">Trend Analysis</h2>
            <div className="grid grid-cols-2 gap-3">
              {[
                {
                  label: "Per Turn",
                  value: `${tickRate! > 0 ? "+" : ""}${tickRate!.toFixed(tickDecimals)}${def.formatSuffix ?? ""}`,
                  color: tickIsGood ? "text-success" : "text-error",
                },
                {
                  label: "Per Year (48 turns)",
                  value: `${yearlyChange >= 0 ? "+" : ""}${yearlyChange.toFixed(def.decimals ?? 1)}${def.formatSuffix ?? ""}`,
                  color: tickIsGood ? "text-success" : "text-error",
                },
                { label: "Current", value: fmt(value), color: "text-foreground" },
                {
                  label: "In 1 Year",
                  value: fmt(projectedYearValue),
                  color: tickIsGood ? "text-success" : "text-error",
                },
              ].map(({ label, value: v, color }) => (
                <div
                  key={label}
                  className="rounded-xl border border-card-border/30 bg-card-muted px-4 py-3"
                >
                  <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.16em] text-muted/70">
                    {label}
                  </p>
                  <p className={`text-lg font-bold tabular-nums ${color}`}>{v}</p>
                </div>
              ))}
            </div>
            <div className="rounded-lg border border-card-border/20 bg-card-muted px-4 py-3 text-xs leading-relaxed text-muted">
              <p className="mb-1 font-medium text-foreground/70">How this works</p>
              <p>
                Active legislation is directly pushing this metric by {tickRate! > 0 ? "+" : ""}
                {tickRate!.toFixed(tickDecimals)}
                {def.formatSuffix ?? ""}/turn via direct policy effects. Separately, the exponential
                decay system also slowly pulls metrics toward equilibrium targets based on your full
                policy mix — so total movement may be slightly faster. Projections assume no policy
                changes.
              </p>
            </div>
          </div>
        )}

        {/* Affecting Policies */}
        {affectingPolicies && affectingPolicies.length > 0 && (
          <div className="space-y-4 rounded-2xl border border-card-border bg-card p-6">
            <h2 className="text-sm font-semibold">Policies Influencing This Metric</h2>
            <ul className="space-y-2">
              {affectingPolicies.map((p, i) => {
                const isGoodPush = def.isHigherBetter ? p.pushesMetricUp : !p.pushesMetricUp;
                return (
                  <li
                    key={i}
                    className="flex items-start justify-between gap-3 rounded-xl border border-card-border/30 bg-card-muted px-4 py-3"
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-foreground">{p.name}</div>
                      {p.policyOptionName && (
                        <div className="mt-0.5 text-xs text-muted">
                          Stance: <span className="text-foreground/80">{p.policyOptionName}</span>
                        </div>
                      )}
                      <div className="mt-0.5 text-[10px] capitalize text-muted/60">
                        {p.scope} policy
                      </div>
                    </div>
                    <span
                      className={`flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${
                        isGoodPush ? "bg-success/15 text-success" : "bg-error/15 text-error"
                      }`}
                    >
                      {p.pushesMetricUp ? "↑" : "↓"}
                      {p.pushesMetricUp ? " Pushing up" : " Pushing down"}
                    </span>
                  </li>
                );
              })}
            </ul>
            <p className="text-[10px] text-muted/50">
              Shows policies with a declared effect on this metric via the decay system. Direction
              reflects the policy&apos;s current stance.
            </p>
          </div>
        )}

        {/* Back */}
        <div className="flex items-center gap-4 text-sm">
          <Link
            href={metricsHomeHref}
            className="flex items-center gap-1.5 text-muted transition-colors hover:text-primary"
          >
            <svg
              className="h-4 w-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            All metrics
          </Link>
        </div>
      </main>
    </div>
  );
}
