"use client";

import { useEffect, useRef, useState } from "react";
import type { ElectionResultsResponse } from "@/lib/elections/liveResults/types";

const POLL_INTERVAL_MS = 30_000;
/** Presidential election night: calls and poll closings land every few seconds. */
const NIGHT_POLL_INTERVAL_MS = 10_000;

/**
 * Keeps a live election results payload fresh: polls the results endpoint
 * every 30s (10s during a presidential election night) while the election is
 * active and the tab is visible, following the auto-refresh convention from
 * the election detail page. Stops entirely
 * for completed elections (static data) and while `paused` (simulation mode).
 *
 * `dataVersion` bumps only when the payload actually changed, so views can
 * key animations off it without replaying on no-op polls.
 */
export function useLiveResultsPoll(
  electionId: string,
  isActive: boolean,
  initialData: ElectionResultsResponse,
  paused = false
): { data: ElectionResultsResponse; dataVersion: number; lastFetchedAt: Date | null } {
  // `initialData` is fixed for the lifetime of the mount (the page remounts
  // per election id), so it seeds state without needing a sync effect.
  const [data, setData] = useState(initialData);
  const [dataVersion, setDataVersion] = useState(0);
  const [lastFetchedAt, setLastFetchedAt] = useState<Date | null>(null);
  const dataRef = useRef(initialData);
  const nightActive = data.election.night != null;

  useEffect(() => {
    if (!isActive || paused) return;

    let cancelled = false;
    const poll = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const res = await fetch(`/api/elections/${electionId}/results`);
        if (!res.ok || cancelled) return;
        const next = (await res.json()) as ElectionResultsResponse;
        setLastFetchedAt(new Date());
        // Cheap change check: turn stamp + drip progress + vote total.
        const prev = dataRef.current;
        const changed =
          next.lastUpdated !== prev.lastUpdated ||
          next.election.finalHour?.progress !== prev.election.finalHour?.progress ||
          next.summary.totalVotes !== prev.summary.totalVotes ||
          next.summary.unitsCalled !== prev.summary.unitsCalled ||
          next.election.night?.feed.length !== prev.election.night?.feed.length ||
          (next.election.night == null) !== (prev.election.night == null);
        if (changed) {
          dataRef.current = next;
          setData(next);
          setDataVersion((v) => v + 1);
        }
      } catch {
        // Silent — keep showing the last good payload.
      }
    };

    const interval = setInterval(
      () => void poll(),
      nightActive ? NIGHT_POLL_INTERVAL_MS : POLL_INTERVAL_MS
    );
    // Refresh promptly when the tab regains focus rather than waiting a cycle.
    let visibilityTimer: ReturnType<typeof setTimeout> | null = null;
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      if (visibilityTimer) clearTimeout(visibilityTimer);
      visibilityTimer = setTimeout(() => void poll(), 100);
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      clearInterval(interval);
      if (visibilityTimer) clearTimeout(visibilityTimer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [electionId, isActive, paused, nightActive]);

  return { data, dataVersion, lastFetchedAt };
}
