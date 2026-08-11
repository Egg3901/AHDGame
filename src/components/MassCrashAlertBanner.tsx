"use client";

/**
 * Page-wide dismissible banner for global crisis alerts (currently mass-
 * cascade events). Self-fetches from `/api/global-alerts/active` on mount
 * and re-polls on a slow interval. Mounted near layout root so it surfaces
 * regardless of which page the user is on.
 *
 * Each user's dismissals are tracked server-side, so dismissing on one
 * device removes the alert across sessions.
 */
import { useEffect, useState } from "react";
import Link from "next/link";

interface AlertItem {
  id: string;
  kind: "mass-cascade";
  countryCode: string;
  insolventCorpCount: number;
  emittedAtTurn: number;
  emittedAtRealtimeMs: number;
  expiresAtRealtimeMs: number;
}

const POLL_INTERVAL_MS = 60_000; // 1 minute

export function MassCrashAlertBanner() {
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [dismissing, setDismissing] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/global-alerts/active");
        if (!res.ok) return;
        const body = (await res.json()) as { alerts: AlertItem[] };
        if (!cancelled) setAlerts(body.alerts);
      } catch {
        // ignore — banner is best-effort
      }
    }
    void load();
    const handle = setInterval(load, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(handle);
    };
  }, []);

  if (alerts.length === 0) return null;
  const top = alerts[0];

  async function dismiss(id: string) {
    setDismissing(id);
    try {
      await fetch(`/api/global-alerts/${id}/dismiss`, { method: "POST" });
      setAlerts((prev) => prev.filter((a) => a.id !== id));
    } finally {
      setDismissing(null);
    }
  }

  return (
    <div className="border-b border-rose-700 bg-rose-600 text-white">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-2">
        <div className="flex items-center gap-3">
          <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-white/20 text-sm font-bold">
            !
          </span>
          <p className="text-sm">
            <span className="font-semibold">Systemic Crisis Alert — {top.countryCode}:</span>{" "}
            {top.insolventCorpCount} corporations insolvent in a single sovereign-default cascade.{" "}
            <Link href="/international/imf" className="underline hover:no-underline">
              View IMF response
            </Link>
            {alerts.length > 1 ? (
              <span className="ml-2 text-white/80">(+{alerts.length - 1} more)</span>
            ) : null}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void dismiss(top.id)}
          disabled={dismissing === top.id}
          className="rounded bg-white/15 px-2 py-1 text-xs font-medium hover:bg-white/25 disabled:opacity-50"
          aria-label="Dismiss alert"
        >
          {dismissing === top.id ? "Dismissing…" : "Dismiss"}
        </button>
      </div>
    </div>
  );
}
