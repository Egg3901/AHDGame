"use client";

import { useCallback, useEffect, useState } from "react";
import { useRuntimeCountryConfig } from "@/hooks/useRuntimeCountryConfig";
import { Button } from "@/components/ui/Button";
import { CardSkeleton } from "@/components/ui/loading-skeletons";
import { Skeleton } from "@/components/ui/Skeleton";
import type { CountryPoliticalMetricsResponse } from "@/lib/politicalMetrics/queries/countryPoliticalMetrics";
import type { PoliticalMetricsCountryId } from "@/lib/politicalMetrics/types";
import { supportsGovernanceStyle } from "@/lib/governanceStyle/score";
import { CategoryDetailView } from "./components/CategoryDetailView";
import { CompareView } from "./components/CompareView";
import { Masthead } from "./components/Masthead";
import { MetricDetailView } from "./components/MetricDetailView";
import { OverviewView } from "./components/OverviewView";

type View =
  | { kind: "overview" }
  | { kind: "category"; categoryId: string }
  | { kind: "metric"; categoryId: string; metricId: string }
  | { kind: "compare"; categoryId?: string };

export default function PoliticalMetricsClient({ code }: { code: string }) {
  const countryId = code.toUpperCase() as PoliticalMetricsCountryId;
  const { config: runtimeCountry } = useRuntimeCountryConfig(countryId);
  const [data, setData] = useState<CountryPoliticalMetricsResponse | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<View>({ kind: "overview" });

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const res = await fetch(`/api/country/${code}/political-metrics`);
      if (!res.ok) throw new Error(`status ${res.status}`);
      setData((await res.json()) as CountryPoliticalMetricsResponse);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [code]);

  useEffect(() => {
    void load();
  }, [load]);

  const onOpenCategory = useCallback(
    (categoryId: string) => setView({ kind: "category", categoryId }),
    []
  );
  const onOpenMetric = useCallback(
    (categoryId: string, metricId: string) => setView({ kind: "metric", categoryId, metricId }),
    []
  );

  if (loading) {
    return (
      <div className="flex flex-col gap-4">
        <CardSkeleton className="p-4">
          <div className="flex items-center gap-4">
            <Skeleton className="h-16 w-16 rounded-md" />
            <div className="flex flex-1 flex-col gap-2">
              <Skeleton className="h-4 w-2/5" />
              <Skeleton className="h-3 w-3/5" />
            </div>
          </div>
        </CardSkeleton>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 9 }, (_, i) => (
            <CardSkeleton key={i} className="flex h-48 flex-col gap-3 p-4">
              <Skeleton className="h-3 w-1/2" />
              <Skeleton className="h-8 w-1/3" />
              <Skeleton className="min-h-0 flex-1" />
            </CardSkeleton>
          ))}
        </div>
        <div className="text-center font-mono text-body-xs uppercase tracking-widest text-muted">
          Retrieving national situation data…
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="mx-auto mt-12 max-w-lg rounded-lg border border-card-border bg-card p-8 text-center shadow-card">
        <span className="inline-block -rotate-1 rounded border border-error px-2.5 py-0.5 font-mono text-body-xs uppercase tracking-widest text-error">
          Transmission interrupted
        </span>
        <h2 className="mt-4 font-display text-heading-lg text-foreground">
          Registry data unavailable
        </h2>
        <p className="mt-2 text-body text-muted">
          The national situation registry could not be reached. Figures shown elsewhere may be out
          of date. This does not affect stored historical series.
        </p>
        <div className="mt-5">
          <Button variant="primary" onClick={() => void load()}>
            Retry retrieval
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-0">
      <Masthead
        countryId={countryId}
        countryDisplayName={data.countryDisplayName}
        overall={data.overall}
        overallStatus={data.overallStatus}
        year={data.year}
        turn={data.turn}
        onCompare={() => setView({ kind: "compare" })}
      />
      {view.kind === "overview" && (
        <OverviewView
          data={data}
          onOpenCategory={onOpenCategory}
          onOpenMetric={onOpenMetric}
          showGovernanceStyle={
            runtimeCountry ? supportsGovernanceStyle(runtimeCountry.governmentType) : false
          }
        />
      )}
      {view.kind === "category" &&
        (() => {
          const category = data.categories.find((c) => c.id === view.categoryId);
          if (!category) return null;
          return (
            <CategoryDetailView
              data={data}
              category={category}
              onBack={() => setView({ kind: "overview" })}
              onOpenMetric={(metricId) => onOpenMetric(category.id, metricId)}
              onCompareCategory={() => setView({ kind: "compare", categoryId: category.id })}
            />
          );
        })()}
      {view.kind === "metric" &&
        (() => {
          const category = data.categories.find((c) => c.id === view.categoryId);
          const metric = category?.metrics.find((m) => m.id === view.metricId);
          if (!category || !metric) return null;
          return (
            <MetricDetailView
              data={data}
              category={category}
              metric={metric}
              onBackToCategory={() => setView({ kind: "category", categoryId: category.id })}
              onOpenMetric={(metricId) =>
                setView({ kind: "metric", categoryId: category.id, metricId })
              }
            />
          );
        })()}
      {view.kind === "compare" && (
        <CompareView
          home={data}
          initialCategoryId={view.categoryId}
          onBack={() => setView({ kind: "overview" })}
        />
      )}
    </div>
  );
}
