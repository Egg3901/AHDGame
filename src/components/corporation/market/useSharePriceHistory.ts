"use client";

import { useEffect, useState } from "react";
import type { CorpHistoryPoint } from "../CorporationPageTypes";
import { computeDayChange } from "./corpIdentity";

/** Most recent N share-price points kept for the masthead sparkline. */
const SPARK_POINTS = 18;

export interface SharePriceHistoryState {
  /** Chronological (oldest→newest) recent share-price points for the sparkline. */
  series: number[];
  /** Day-over-day change derived from the last two points, or null when unavailable. */
  dayChange: { changePct: number; prevClose: number } | null;
  loading: boolean;
}

/**
 * Lazily fetch a recent slice of the corporation's share-price history for the
 * market masthead. Reuses the same `/history` route the Charts tab consumes.
 * Degrades gracefully (empty series, null dayChange) on error or thin history.
 */
export function useSharePriceHistory(corpId: string, enabled: boolean): SharePriceHistoryState {
  const [state, setState] = useState<SharePriceHistoryState>({
    series: [],
    dayChange: null,
    loading: false,
  });

  useEffect(() => {
    // When disabled (e.g. a private corp viewed by a non-CEO), skip the fetch.
    // The masthead gates the sparkline on the same condition, so leaving any
    // prior data in place is harmless and avoids a synchronous setState here.
    if (!enabled) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/corporations/${corpId}/history`);
        if (!res.ok) {
          if (!cancelled) setState({ series: [], dayChange: null, loading: false });
          return;
        }
        const data = (await res.json()) as { history?: CorpHistoryPoint[] };
        const points = (data.history ?? []).filter(
          (p): p is CorpHistoryPoint => typeof p?.sharePrice === "number"
        );
        const recent = points.slice(-SPARK_POINTS).map((p) => p.sharePrice);
        if (!cancelled) {
          setState({
            series: recent,
            dayChange: computeDayChange(points.map((p) => ({ sharePrice: p.sharePrice }))),
            loading: false,
          });
        }
      } catch {
        if (!cancelled) setState({ series: [], dayChange: null, loading: false });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [corpId, enabled]);

  return state;
}
