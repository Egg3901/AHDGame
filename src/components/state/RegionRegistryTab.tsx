"use client";

/**
 * The political registry at REGION scope — the region page's Metrics tab.
 *
 * Mirrors `PoliticalMetricsClient`'s view state machine and reuses the same
 * national components rather than forking them: forking is what left the old
 * regional board without modifiers, legislation, evidence or trends while the
 * national one had all four.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { CardSkeleton } from "@/components/ui/loading-skeletons";
import { Skeleton } from "@/components/ui/Skeleton";
import { politicalMetricsUrl, regionPoliticalMetricsApiUrl } from "@/lib/urls";
import type { RegionPoliticalMetricsResponse } from "@/lib/politicalMetrics/queries/regionPoliticalMetrics";
import { CategoryDetailView } from "@/app/country/[code]/political-metrics/components/CategoryDetailView";
import { Masthead } from "@/app/country/[code]/political-metrics/components/Masthead";
import { MetricDetailView } from "@/app/country/[code]/political-metrics/components/MetricDetailView";
import { OverviewView } from "@/app/country/[code]/political-metrics/components/OverviewView";
import { RegionCompareView } from "./RegionCompareView";

type View =
  | { kind: "overview" }
  | { kind: "category"; categoryId: string }
  | { kind: "metric"; categoryId: string; metricId: string }
  | { kind: "compare"; categoryId?: string };

export function RegionRegistryTab({
  countryId,
  regionId,
  regionName,
}: {
  countryId: string;
  regionId: string;
  regionName: string;
}) {
  const [data, setData] = useState<RegionPoliticalMetricsResponse | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<View>({ kind: "overview" });

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const res = await fetch(regionPoliticalMetricsApiUrl(countryId, regionId));
      if (!res.ok) throw new Error(`status ${res.status}`);
      setData((await res.json()) as RegionPoliticalMetricsResponse);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [countryId, regionId]);

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
          Retrieving {regionName} situation data…
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
          The {regionName} situation registry could not be reached. Figures shown elsewhere may be
          out of date. This does not affect stored historical series.
        </p>
        <div className="mt-5">
          <Button variant="primary" onClick={() => void load()}>
            Retry retrieval
          </Button>
        </div>
      </div>
    );
  }

  /**
   * `PMRegistryData.countryDisplayName` means "what this registry is about",
   * and the shared views print it as the subtitle: "Economy & Labor · X",
   * "X · seven metrics spanning the ideological range". The region payload's
   * own `countryDisplayName` is the COUNTRY, so passing it straight through
   * would caption every Georgia page "United States".
   */
  const viewData = { ...data, countryDisplayName: data.regionName };

  return (
    <div className="flex min-w-0 flex-col gap-0">
      <Masthead
        countryId={data.countryId}
        countryDisplayName={data.regionName}
        overall={data.overall}
        overallStatus={data.overallStatus}
        year={data.year}
        turn={data.turn}
        onCompare={() => setView({ kind: "compare" })}
        // Region chrome: the registry heading names the region rather than the
        // executive office, and the comparison line carries the country figure
        // so a player can see at a glance whether they are above or below it.
        registryLabel={`${data.regionName} · ${data.regionLabel} situation registry`}
        sealLabel={`${data.countryDisplayName} · ${data.regionLabel}`}
        glyph={data.regionId}
        comparison={{ label: "national", value: data.nationalOverall }}
      />
      {view.kind === "overview" && (
        <OverviewView
          data={viewData}
          onOpenCategory={onOpenCategory}
          onOpenMetric={onOpenMetric}
          // Present unless the country is a one-party state, where the score
          // has no meaning. Scored from this region's own board.
          showGovernanceStyle={Boolean(data.governanceStyle)}
          governanceScopeNote={`Political direction and democratic health are scored from ${data.regionName}'s own board. The balance of power below describes ${data.countryDisplayName}'s legislature and executive, which bear on every ${data.regionLabel.toLowerCase()} alike.`}
        />
      )}
      {view.kind === "category" &&
        (() => {
          const category = data.categories.find((c) => c.id === view.categoryId);
          if (!category) return null;
          return (
            <CategoryDetailView
              data={viewData}
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
              data={viewData}
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
        <RegionCompareView
          home={data}
          initialCategoryId={view.categoryId}
          onBack={() => setView({ kind: "overview" })}
        />
      )}
      {/* The retired regional board carried this link, and it is the natural
          next step from a region's numbers: the country they add up to. */}
      <p className="mt-4 text-body-xs text-muted">
        These are {data.regionName}&apos;s own registry values. The national figures they aggregate
        into are on the{" "}
        <Link
          href={politicalMetricsUrl(countryId)}
          className="text-primary underline-offset-2 hover:underline"
        >
          {data.countryDisplayName} registry
        </Link>
        .
      </p>
    </div>
  );
}

export default RegionRegistryTab;
