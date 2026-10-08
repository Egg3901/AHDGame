"use client";

import { useEffect, useMemo, useState } from "react";
import type { ElectionResultsResponse } from "@/lib/elections/liveResults/types";
import {
  EMPTY_ALERTS,
  ALERT_MS,
  SIM_WINDOW_REAL_MS,
  callAlertsFrom,
  expireAlert,
  hasNight,
  ingestCalls,
  isResolvedStatus,
  nightProgressAt,
  type AlertState,
  type CallAlert,
} from "./nightModel";

const NIGHT_POLL_MS = 10_000;
/** Waiting for the window to open (clock paused, or a hair early). */
const IDLE_POLL_MS = 30_000;

/** Wall-clock `now`, refreshed every `intervalMs`. */
export function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

/** Real length of the night window in ms; a replay plays in a fixed compressed time. */
export function nightWindowRealMs(data: ElectionResultsResponse): number {
  const night = data.election.night;
  if (data.simulated || !night) return SIM_WINDOW_REAL_MS;
  return Math.max(0, Date.parse(night.windowEnd) - Date.parse(night.windowStart));
}

/** Progress through the night, smoothed between polls for a live viewer. */
export function useNightProgress(data: ElectionResultsResponse): number {
  const now = useNow(1000);
  if (!data.election.night) return 1;
  return nightProgressAt(
    data.election,
    Date.parse(data.lastUpdated),
    now,
    nightWindowRealMs(data),
    !data.simulated
  );
}

/**
 * The call alert on screen, plus a token that changes with each alert so the
 * map can replay its highlight. The first feed a viewer receives is only
 * marked seen (see `ingestCalls`), so joining mid-night shows no stale alerts.
 */
export function useCallAlerts(data: ElectionResultsResponse): {
  active: CallAlert | null;
  dismiss: () => void;
} {
  const calls = useMemo(() => callAlertsFrom(data, data.election.night?.feed), [data]);
  const signature = calls.map((c) => c.key).join("|");
  const [alerts, setAlerts] = useState<AlertState>(() => ingestCalls(EMPTY_ALERTS, calls));
  const [lastSignature, setLastSignature] = useState(signature);
  if (signature !== lastSignature) {
    setLastSignature(signature);
    setAlerts((prev) => ingestCalls(prev, calls));
  }

  const active = alerts.active;
  useEffect(() => {
    if (!active) return;
    const t = setTimeout(() => setAlerts(expireAlert), ALERT_MS);
    return () => clearTimeout(t);
  }, [active]);

  return { active, dismiss: () => setAlerts(expireAlert) };
}

export interface NightHold {
  /** Show the broadcast: the night is on, or it just resolved and the viewer has not moved on. */
  show: boolean;
  /** The night is over and the board has settled on the real result. */
  settled: boolean;
  /** Leave the settled broadcast for the concluded screen. */
  dismiss: () => void;
}

/**
 * Keeps the broadcast on screen through the hand-off. Once a viewer has seen
 * the night, a payload that has resolved settles the board (it does not snap
 * to the concluded page) until the viewer follows the link on.
 */
export function useNightHold(data: ElectionResultsResponse | null): NightHold {
  const night = hasNight(data);
  // A replay never arms the hold: leaving it must not settle a real, ended race.
  const [saw, setSaw] = useState(night && !data?.simulated);
  const [dismissed, setDismissed] = useState(false);
  if (night && !data?.simulated && !saw) setSaw(true);
  const resolved = data != null && isResolvedStatus(data.election.status);
  const settled = !night && saw && resolved && !dismissed;
  return { show: night || settled, settled, dismiss: () => setDismissed(true) };
}

type WatchState =
  | { kind: "idle" }
  | { kind: "off" }
  | { kind: "failed" }
  | { kind: "ready"; data: ElectionResultsResponse };

/** Statuses after which the payload no longer changes. */
const FINAL_STATUSES = new Set(["resolved", "cancelled"]);

/**
 * Election detail page: from the last turn interval, watch the results
 * payload. `pending` holds the page back while the first payload loads, so the
 * normal screen (and its projections) never flashes before the night shows.
 */
export function useNightWatch(
  electionId: string | null,
  enabled: boolean
): { data: ElectionResultsResponse | null; pending: boolean; hold: NightHold } {
  const [state, setState] = useState<WatchState>({ kind: "idle" });
  const data = state.kind === "ready" ? state.data : null;
  const hold = useNightHold(data);
  // `completed` means voting closed but the engine may still be resolving the
  // race (a House contingent ballot included); keep watching until `resolved`
  // so the settled board shows the winner the engine actually seated.
  const finished = data != null && FINAL_STATUSES.has(data.election.status);
  const nightOn = hasNight(data);
  const resolving = data != null && isResolvedStatus(data.election.status) && !finished;
  // Once armed the watch stays on through the hand-off, even after the detail
  // payload reports the race ended and `enabled` drops.
  const [armed, setArmed] = useState(enabled);
  if (enabled && !armed) setArmed(true);
  const active = armed && electionId != null && state.kind !== "off" && !finished;

  useEffect(() => {
    if (!active || !electionId) return;
    let cancelled = false;
    const load = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const res = await fetch(`/api/elections/${electionId}/results`);
        if (cancelled) return;
        if (res.status === 403) {
          setState({ kind: "off" });
          return;
        }
        if (!res.ok) {
          setState((prev) => (prev.kind === "idle" ? { kind: "failed" } : prev));
          return;
        }
        const next = (await res.json()) as ElectionResultsResponse;
        if (!cancelled && next.election.id === electionId) setState({ kind: "ready", data: next });
      } catch {
        // Keep the last good payload; the next poll tries again.
        setState((prev) => (prev.kind === "idle" ? { kind: "failed" } : prev));
      }
    };
    void load();
    const interval = setInterval(
      () => void load(),
      nightOn || resolving ? NIGHT_POLL_MS : IDLE_POLL_MS
    );
    const onVisible = () => void load();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [active, electionId, nightOn, resolving]);

  return { data, pending: armed && state.kind === "idle", hold };
}
