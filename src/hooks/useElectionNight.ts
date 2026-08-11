/**
 * Shared client hook for election-night payloads.
 * Used by `/elections/[id]/results` and country-page embeds so US House and
 * UK Commons load/poll through one path.
 */
"use client";

import { useCallback, useEffect, useState } from "react";
import type { ElectionResultsResponse } from "@/lib/elections/liveResults/types";
import { useLiveResultsPoll } from "@/hooks/useLiveResultsPoll";

export type ElectionNightLoadState =
  | { kind: "loading" }
  | { kind: "disabled" }
  | { kind: "error"; message: string }
  | { kind: "ready"; data: ElectionResultsResponse };

async function fetchElectionNight(electionId: string): Promise<ElectionNightLoadState> {
  try {
    const res = await fetch(`/api/elections/${electionId}/results`);
    if (res.status === 403) return { kind: "disabled" };
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      return { kind: "error", message: body?.error ?? "Failed to load results" };
    }
    return { kind: "ready", data: (await res.json()) as ElectionResultsResponse };
  } catch {
    return { kind: "error", message: "Failed to load results" };
  }
}

/** Stable identity so consumers can safely put `state` in a dependency array. */
const LOADING: ElectionNightLoadState = { kind: "loading" };

/**
 * Initial fetch of election-night results. Callers that need polling after
 * ready should use {@link useElectionNightPoll} with the loaded payload.
 */
export function useElectionNightLoad(electionId: string): {
  state: ElectionNightLoadState;
  reload: () => void;
} {
  // The payload is stored against the id it belongs to, so "results for a
  // different election" is derived during render rather than corrected by a
  // synchronous setState inside the effect (which triggers cascading renders,
  // and only reset to loading *after* one render had already shown the
  // previous election's results).
  const [loaded, setLoaded] = useState<{ id: string; state: ElectionNightLoadState } | null>(null);

  const reload = useCallback(() => {
    setLoaded(null);
    void fetchElectionNight(electionId).then((next) => setLoaded({ id: electionId, state: next }));
  }, [electionId]);

  useEffect(() => {
    let cancelled = false;
    void fetchElectionNight(electionId).then((next) => {
      if (!cancelled) setLoaded({ id: electionId, state: next });
    });
    return () => {
      cancelled = true;
    };
  }, [electionId]);

  // A resolved payload for a previous id reads as loading until the in-flight
  // fetch for the current one lands.
  return { state: loaded?.id === electionId ? loaded.state : LOADING, reload };
}

/** Poll while active once an initial payload is ready. */
export function useElectionNightPoll(
  electionId: string,
  initialData: ElectionResultsResponse,
  paused = false
): { data: ElectionResultsResponse; dataVersion: number; lastFetchedAt: Date | null } {
  return useLiveResultsPoll(
    electionId,
    initialData.election.status === "active",
    initialData,
    paused
  );
}
