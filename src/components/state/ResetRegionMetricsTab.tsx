"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { CardSkeleton, Skeleton } from "@/components/ui";
import {
  ResetMetricBoard,
  type ResetMetricBoardResponse,
  type ResetMetricCountry,
} from "@/components/metrics/ResetMetricBoard";
import { COUNTRY_CONFIGS } from "@/lib/constants/countries";

export function ResetRegionMetricsTab({
  countryId,
  regionId,
  regionName,
}: {
  countryId: ResetMetricCountry;
  regionId: string;
  regionName: string;
}) {
  const config = COUNTRY_CONFIGS[countryId];
  const [board, setBoard] = useState<ResetMetricBoardResponse | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [requestVersion, setRequestVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;

    void fetch(`/api/country/${countryId}/reset-metrics?region=${encodeURIComponent(regionId)}`, {
      cache: "no-store",
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`status ${response.status}`);
        return (await response.json()) as ResetMetricBoardResponse;
      })
      .then((result) => {
        if (
          result.countryId !== countryId ||
          result.scope !== "regional" ||
          result.regionId !== regionId
        ) {
          throw new Error("Metric board does not describe the requested region");
        }
        if (!cancelled) setBoard(result);
      })
      .catch(() => {
        if (!cancelled) {
          setBoard(null);
          setError(true);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [countryId, regionId, requestVersion]);

  if (loading) {
    return (
      <div className="space-y-4" role="status">
        <CardSkeleton className="p-5">
          <Skeleton className="h-8 w-2/5" />
          <Skeleton className="mt-3 h-4 w-3/5" />
        </CardSkeleton>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {Array.from({ length: 5 }, (_, index) => (
            <CardSkeleton key={index} className="p-4">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="mt-3 h-7 w-1/3" />
            </CardSkeleton>
          ))}
        </div>
        <span className="sr-only">Loading metrics for {regionName}</span>
      </div>
    );
  }

  if (error || !board) {
    return (
      <div className="mx-auto mt-12 max-w-lg rounded-lg border border-card-border bg-card p-8 text-center shadow-card">
        <span className="inline-block rounded border border-error px-2.5 py-0.5 font-mono text-body-xs uppercase tracking-widest text-error">
          Metric registry unavailable
        </span>
        <h2 className="mt-4 text-heading-lg text-foreground">Metrics could not be loaded</h2>
        <p className="mt-2 text-body text-muted">
          The {regionName} metric board could not be verified. Legacy metrics are not substituted
          while this world is using the updated metric system.
        </p>
        <div className="mt-5">
          <Button
            variant="primary"
            onClick={() => {
              setLoading(true);
              setError(false);
              setRequestVersion((version) => version + 1);
            }}
          >
            Retry retrieval
          </Button>
        </div>
      </div>
    );
  }

  return (
    <ResetMetricBoard
      board={board}
      displayName={regionName}
      countryName={config.name}
      regionLabel={config.regionLabel}
    />
  );
}

export default ResetRegionMetricsTab;
