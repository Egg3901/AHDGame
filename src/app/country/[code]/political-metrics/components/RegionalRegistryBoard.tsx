"use client";

/**
 * SP6 — the political registry at REGIONAL scope. Renders the nine category
 * cards from this region's own politicalMetrics values (the same per-region
 * docs the national registry aggregates), in the exact national card grammar.
 * Consumed by the playable region pages' Metrics tab; cards open the full
 * national registry, which carries the drill-downs, modifiers, and evidence.
 */

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { LiveDot } from "@/components/ui/Badge";
import type { CountryPoliticalMetricsResponse } from "@/lib/politicalMetrics/queries/countryPoliticalMetrics";
import { statusFor } from "@/lib/politicalMetrics/display";
import { politicalMetricsUrl } from "@/lib/urls";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { CategoryCard, type PMCategory } from "./CategoryCard";
import { RegionalCategoryDetail } from "./RegionalCategoryDetail";
import { StatusBadge } from "./StatusBadge";
import { scoreTone } from "./tones";

export function RegionalRegistryBoard({
  countryId,
  regionId,
  regionName,
}: {
  countryId: string;
  regionId: string;
  regionName: string;
}) {
  const router = useRouter();
  const [data, setData] = useState<CountryPoliticalMetricsResponse | null>(null);
  const [failed, setFailed] = useState(false);
  /** null = overview cards; otherwise the open category's id (regional drill-down). */
  const [openCategory, setOpenCategory] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/country/${countryId.toLowerCase()}/political-metrics`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${r.status}`))))
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [countryId]);

  // Re-score every category from THIS region's values (fall back to the
  // national value only when the region has no entry for a metric).
  const regional = useMemo(() => {
    if (!data) return null;
    const categories: PMCategory[] = data.categories.map((cat) => {
      const metrics = cat.metrics.map((m) => {
        const value = m.regions.find((r) => r.regionId === regionId)?.value ?? m.nationalValue;
        return { ...m, nationalValue: value, status: statusFor(value) };
      });
      const score = metrics.reduce((sum, m) => sum + m.nationalValue, 0) / (metrics.length || 1);
      return {
        ...cat,
        metrics,
        score: Math.round(score * 10) / 10,
        status: statusFor(score),
      };
    });
    const overall = categories.reduce((sum, c) => sum + c.score, 0) / (categories.length || 1);
    return { categories, overall: Math.round(overall * 10) / 10 };
  }, [data, regionId]);

  if (failed) return null; // registry unavailable — the tab's statistics still render

  if (!regional || !data) {
    return (
      <div className="rounded-lg border border-card-border bg-card p-6 shadow-panel">
        <div className="mx-auto h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  const tone = scoreTone(regional.overall);
  const openRegistry = () => router.push(politicalMetricsUrl(countryId));
  const delta = Math.round((regional.overall - data.overall) * 10) / 10;

  return (
    <section className="overflow-hidden rounded-lg border border-card-border bg-card shadow-panel">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-card-border px-4 py-2 font-mono text-body-xs uppercase tracking-widest text-muted">
        <span>{regionName} · Situation registry</span>
        <span className="inline-flex items-center gap-2">
          <LiveDot color="success" />
          LIVE · SERIES {data.year}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-4 border-b border-card-border p-4">
        <div>
          <span className={`text-display font-extrabold leading-none tabular-nums ${tone.text}`}>
            {Math.round(regional.overall)}
          </span>
          <span className="text-body-sm text-muted">/100</span>
        </div>
        <StatusBadge score={regional.overall} label={statusFor(regional.overall)} />
        <span className="text-body-sm text-muted">
          mean of nine category scores · national {Math.round(data.overall)}
          {delta !== 0 && (
            <span className={delta > 0 ? "text-success" : "text-error"}>
              {" "}
              ({delta > 0 ? "+" : ""}
              {delta})
            </span>
          )}
        </span>
        <button
          type="button"
          onClick={openRegistry}
          className="ml-auto rounded border border-primary/40 bg-card-muted px-3 py-1.5 font-mono text-body-xs font-bold uppercase tracking-wider text-primary transition-colors hover:bg-primary/10"
        >
          National registry →
        </button>
      </div>
      {openCategory ? (
        <RegionalCategoryDetail
          regionId={regionId}
          regionName={regionName}
          national={data.categories.find((c) => c.id === openCategory)!}
          regional={regional.categories.find((c) => c.id === openCategory)!}
          onBack={() => setOpenCategory(null)}
        />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 p-4 md:grid-cols-2 xl:grid-cols-3">
            {regional.categories.map((cat) => (
              <CategoryCard
                key={cat.id}
                category={cat}
                onOpenCategory={(id) => setOpenCategory(id)}
                onOpenMetric={(id) => setOpenCategory(id)}
              />
            ))}
          </div>
          <p className="border-t border-card-border px-4 py-2.5 text-body-xs text-muted">
            Scores are {regionName}&apos;s own registry values — open a category to drill into its
            metrics and compare against other {regionLabelPlural(countryId)}. Active modifiers and
            underlying statistics live on the national registry.
          </p>
        </>
      )}
    </section>
  );
}

/** Lowercased plural region label ("states", "regions", "republics"). */
function regionLabelPlural(countryId: string): string {
  return (
    COUNTRY_CONFIGS[countryId.toUpperCase() as CountryId]?.regionLabelPlural ?? "regions"
  ).toLowerCase();
}

export default RegionalRegistryBoard;
