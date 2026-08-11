"use client";

/**
 * Page-wide banner shown only while maintenance mode is "partial" — the site
 * stays browsable but registration and character creation are blocked at the
 * API layer (see POST /api/auth/register, /api/auth/character). Modeled on
 * `MassCrashAlertBanner`: self-fetches the public `/api/maintenance` status
 * on mount and re-polls on a slow interval, rendering nothing outside
 * partial mode. Uses the warning/amber status color, not error-red — this
 * isn't an outage, browsing still works.
 */
import { useEffect, useState } from "react";

interface MaintenanceStatusResponse {
  mode?: "off" | "partial" | "full";
  enabled: boolean;
  reason: string;
  expectedEnd: string;
}

const POLL_INTERVAL_MS = 60_000; // 1 minute
const DEFAULT_REASON =
  "The game is in limited maintenance. Browsing is available; registration and new characters are temporarily paused.";

export function MaintenancePartialBanner() {
  const [status, setStatus] = useState<MaintenanceStatusResponse | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/maintenance");
        if (!res.ok) return;
        const body = (await res.json()) as MaintenanceStatusResponse;
        if (!cancelled) setStatus(body);
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

  if (status?.mode !== "partial") return null;

  return (
    <div className="relative z-40 border-b border-warning/30 bg-warning/10 text-warning-muted">
      <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-2">
        <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-warning/20 text-sm font-bold text-warning">
          !
        </span>
        <p className="text-sm">
          <span className="font-semibold text-warning">Limited Maintenance:</span>{" "}
          {status.reason || DEFAULT_REASON}
          {status.expectedEnd ? (
            <span className="ml-1 text-warning/80">
              (expected back to normal {new Date(status.expectedEnd).toLocaleString("en-US")})
            </span>
          ) : null}
        </p>
      </div>
    </div>
  );
}
