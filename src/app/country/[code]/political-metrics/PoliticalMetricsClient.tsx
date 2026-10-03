"use client";

import { useCallback, useEffect, useState } from "react";
import { useRuntimeCountryConfig } from "@/hooks/useRuntimeCountryConfig";
import { Button } from "@/components/ui/Button";
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

/** Placeholder in the shape of the loaded page: header, summary, then the table. */
function LoadingState() {
  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-lg border border-card-border bg-card p-5 sm:p-6">
        <Skeleton className="h-9 w-56 max-w-full" />
        <Skeleton className="mt-3 h-4 w-72 max-w-full" />
        <Skeleton className="mt-6 h-12 w-40" />
        <Skeleton className="mt-3 h-4 w-96 max-w-full" />
      </div>
      <div className="grid grid-cols-2 gap-x-8 gap-y-6 sm:grid-cols-3 lg:grid-cols-5">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i}>
            <Skeleton className="h-3 w-24 max-w-full" />
            <Skeleton className="mt-2 h-5 w-12" />
          </div>
        ))}
      </div>
      <div className="mt-6">
        <Skeleton className="h-7 w-40" />
        <div className="mt-4 space-y-3">
          {Array.from({ length: 9 }, (_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      </div>
      <p role="status" className="text-center text-body text-muted">
        Loading political metrics…
      </p>
    </div>
  );
}

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

  if (loading) return <LoadingState />;

  if (error || !data) {
    return (
      <div role="alert" className="mx-auto mt-12 max-w-lg text-center">
        <h2 className="text-heading-lg font-semibold text-foreground">
          Political metrics could not load
        </h2>
        <p className="mt-2 text-body text-muted">
          The figures could not be fetched just now, so anything shown elsewhere may be out of date.
          Stored history is not affected.
        </p>
        <div className="mt-5">
          <Button variant="primary" onClick={() => void load()}>
            Try again
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      <Masthead
        countryDisplayName={data.countryDisplayName}
        overall={data.overall}
        overallStatus={data.overallStatus}
        year={data.year}
        turn={data.turn}
        onCompare={() => setView({ kind: "compare" })}
        compareLabel="Compare countries"
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
