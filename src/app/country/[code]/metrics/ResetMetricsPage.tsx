"use client";

import { useEffect, useState } from "react";
import {
  ResetMetricBoard,
  type ResetMetricBoardResponse,
  type ResetMetricCountry,
} from "@/components/metrics/ResetMetricBoard";
import { COUNTRY_CONFIGS } from "@/lib/constants/countries";

export function ResetMetricsPage({ country }: { country: ResetMetricCountry }) {
  const config = COUNTRY_CONFIGS[country];
  const [board, setBoard] = useState<ResetMetricBoardResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let alive = true;
    void fetch(`/api/country/${country}/reset-metrics`, {
      signal: controller.signal,
      cache: "no-store",
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Metric board request failed (${response.status})`);
        return (await response.json()) as ResetMetricBoardResponse;
      })
      .then((response) => {
        if (!alive) return;
        if (
          response.countryId !== country ||
          response.scope !== "national" ||
          response.regionId !== null
        ) {
          throw new Error("Metric board does not describe the requested country");
        }
        setBoard(response);
      })
      .catch((cause: unknown) => {
        if (!alive || controller.signal.aborted) return;
        setError(cause instanceof Error ? cause.message : "Metric board could not be loaded");
        setBoard(null);
      });
    return () => {
      alive = false;
      controller.abort();
    };
  }, [country, retry]);

  return (
    <main className="mx-auto max-w-7xl overflow-x-hidden px-4 py-6 pb-16 sm:px-6">
      {error && (
        <div role="alert" className="rounded-lg border border-error/40 bg-error/10 p-4 text-error">
          <p>Metrics are temporarily unavailable: {error}</p>
          <button
            type="button"
            className="mt-2 underline"
            onClick={() => {
              setError(null);
              setRetry((value) => value + 1);
            }}
          >
            Retry
          </button>
        </div>
      )}
      {!error && !board && <p role="status">Loading metric registry...</p>}
      {board && !error && (
        <ResetMetricBoard
          board={board}
          displayName={config.name}
          countryName={config.name}
          regionLabel={config.regionLabel}
        />
      )}
    </main>
  );
}
