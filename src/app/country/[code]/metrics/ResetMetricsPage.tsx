"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { states1991 } from "@/lib/countries/us/data/usStates1991";
import { ukRegions1991 } from "@/lib/countries/uk/data/ukRegions1991";
import { jpRegions1991 } from "@/lib/countries/jp/data/jpRegions1991";
import type { PrimaryMetricDefinition } from "@/lib/resetMetrics/catalog";
import type { OpeningMetricObservation } from "@/lib/resetMetrics/rules/openingObservation";

type ResetCountry = "US" | "UK" | "JP";
type MetricRow = PrimaryMetricDefinition & {
  observation: OpeningMetricObservation;
  temporaryActionEffect: {
    favorableNormalizedPoints: number;
    contributingActions: string[];
  } | null;
  legislativeEffect: {
    favorableNormalizedPoints: number;
    contributingPrograms: string[];
  } | null;
};
type MetricBoardResponse = {
  version: "v2";
  countryId: ResetCountry;
  scope: "national" | "regional";
  regionId: string | null;
  asOfTurn: number;
  metrics: MetricRow[];
};

const regions = { US: states1991, UK: ukRegions1991, JP: jpRegions1991 } as const;
const names: Record<ResetCountry, string> = {
  US: "United States",
  UK: "United Kingdom",
  JP: "Japan",
};

function readableCategory(category: string): string {
  return category
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/^./, (letter) => letter.toUpperCase());
}

function valueLabel(row: MetricRow): string {
  const value = row.observation.value;
  if (value === null) return "Unavailable";
  const precision = Math.abs(value) < 10 ? 2 : 1;
  return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: precision }).format(value)} ${row.unit}`;
}

function interpretationLabel(interpretation: PrimaryMetricDefinition["interpretation"]): string {
  switch (interpretation) {
    case "higher":
      return "Higher is generally better";
    case "lower":
      return "Lower is generally better";
    case "band":
      return "A balanced range is preferred";
    case "context":
      return "Context measure, not inherently good or bad";
  }
}

function MetricSection({ title, rows }: { title: string; rows: MetricRow[] }) {
  const grouped = useMemo(() => {
    const groups = new Map<string, MetricRow[]>();
    for (const row of rows) {
      const category = row.path.split(".")[0] ?? "other";
      groups.set(category, [...(groups.get(category) ?? []), row]);
    }
    return [...groups.entries()];
  }, [rows]);
  return (
    <section className="space-y-5" aria-label={title}>
      <h2 className="text-xl font-semibold text-foreground">{title}</h2>
      {grouped.map(([category, metrics]) => (
        <div key={category} className="space-y-3">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted">
            {readableCategory(category)}
          </h3>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {metrics.map((metric) => (
              <article
                key={metric.id}
                className="rounded-xl border border-border bg-card p-4"
                title={metric.description}
              >
                <div className="flex items-start justify-between gap-2">
                  <h4 className="font-semibold text-foreground">{metric.name}</h4>
                  <span className="text-xs text-muted">{metric.id}</span>
                </div>
                <p className="mt-2 text-lg font-semibold tabular-nums text-foreground">
                  {valueLabel(metric)}
                </p>
                <p className="mt-1 text-xs text-muted">
                  {interpretationLabel(metric.interpretation)}
                </p>
                {metric.temporaryActionEffect && (
                  <p
                    className="mt-2 text-xs font-semibold text-success"
                    title={`Active actions: ${metric.temporaryActionEffect.contributingActions.join(", ")}`}
                  >
                    +{metric.temporaryActionEffect.favorableNormalizedPoints.toFixed(2)} temporary
                    favorable effect
                  </p>
                )}
                {metric.legislativeEffect && (
                  <p
                    className={`mt-2 text-xs font-semibold ${
                      metric.legislativeEffect.favorableNormalizedPoints >= 0
                        ? "text-success"
                        : "text-error"
                    }`}
                    title={`Enacted law families: ${metric.legislativeEffect.contributingPrograms.join(", ")}. This is modeled policy pressure; the displayed observation remains owned by its source system.`}
                  >
                    {metric.legislativeEffect.favorableNormalizedPoints >= 0 ? "+" : ""}
                    {metric.legislativeEffect.favorableNormalizedPoints.toFixed(2)} enacted-law
                    pressure
                  </p>
                )}
                <p className="mt-3 text-sm leading-relaxed text-muted">{metric.description}</p>
                <div className="mt-3 border-t border-border pt-3 text-xs leading-relaxed text-muted">
                  <p>Owner: {metric.owner}</p>
                  <p>Source: {metric.observation.source}</p>
                  <p>{metric.observation.note}</p>
                  {metric.observation.status === "proxy" && (
                    <p className="mt-1 text-amber-400">Game-calibrated proxy</p>
                  )}
                </div>
              </article>
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}

export function ResetMetricsPage({ country }: { country: ResetCountry }) {
  const regionOptions = regions[country];
  const [regionId, setRegionId] = useState<string>(regionOptions[0]?._id ?? "");
  const [national, setNational] = useState<MetricBoardResponse | null>(null);
  const [regional, setRegional] = useState<MetricBoardResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let alive = true;
    const base = `/api/country/${country}/reset-metrics`;
    const load = async (url: string): Promise<MetricBoardResponse> => {
      const response = await fetch(url, { signal: controller.signal, cache: "no-store" });
      if (!response.ok) throw new Error(`Metric board request failed (${response.status})`);
      return (await response.json()) as MetricBoardResponse;
    };
    void Promise.all([load(base), load(`${base}?region=${encodeURIComponent(regionId)}`)])
      .then(([countryBoard, regionBoard]) => {
        if (!alive) return;
        if (
          countryBoard.countryId !== country ||
          countryBoard.scope !== "national" ||
          regionBoard.countryId !== country ||
          regionBoard.scope !== "regional" ||
          regionBoard.regionId !== regionId ||
          countryBoard.asOfTurn !== regionBoard.asOfTurn
        ) {
          throw new Error("Metric boards do not describe the same country and turn");
        }
        setNational(countryBoard);
        setRegional(regionBoard);
      })
      .catch((cause: unknown) => {
        if (!alive || controller.signal.aborted) return;
        setError(cause instanceof Error ? cause.message : "Metric boards could not be loaded");
        setNational(null);
        setRegional(null);
      });
    return () => {
      alive = false;
      controller.abort();
    };
  }, [country, regionId, retry]);

  return (
    <main className="mx-auto max-w-7xl space-y-7 px-4 py-8 sm:px-6">
      <nav className="text-sm text-muted">
        <Link href={`/country/${country.toLowerCase()}`} className="hover:underline">
          {names[country]}
        </Link>{" "}
        / Metrics
      </nav>
      <header>
        <p className="text-xs font-semibold uppercase tracking-widest text-primary">
          Primary metrics, version 2
        </p>
        <h1 className="mt-2 text-3xl font-bold text-foreground">{names[country]} metrics</h1>
        <p className="mt-2 max-w-3xl text-sm text-muted">
          These measures describe observed conditions, not permanent bonuses from passing a law.
          Each card names its owner, source, and whether the value is a game-calibrated proxy.
        </p>
      </header>
      <label className="block max-w-sm text-sm font-medium text-foreground">
        State or region
        <select
          value={regionId}
          onChange={(event) => {
            setRegionId(event.target.value);
            setRegional(null);
            setError(null);
          }}
          className="mt-2 w-full rounded-lg border border-border bg-card px-3 py-2 text-foreground"
        >
          {regionOptions.map((region) => (
            <option key={region._id} value={region._id}>
              {region.name}
            </option>
          ))}
        </select>
      </label>
      {error && (
        <div role="alert" className="rounded-lg border border-error/40 bg-error/10 p-4 text-error">
          <p>Version 2 metrics are temporarily unavailable: {error}</p>
          <button
            type="button"
            className="mt-2 underline"
            onClick={() => {
              setError(null);
              setRetry((n) => n + 1);
            }}
          >
            Retry
          </button>
        </div>
      )}
      {!error && (!national || !regional) && <p role="status">Loading metric boards...</p>}
      {national && regional && !error && (
        <>
          <p className="text-xs text-muted">As of turn {national.asOfTurn}</p>
          <MetricSection title="National conditions" rows={national.metrics} />
          <MetricSection
            title={`${regionOptions.find((region) => region._id === regionId)?.name ?? regionId} conditions`}
            rows={regional.metrics}
          />
        </>
      )}
    </main>
  );
}
