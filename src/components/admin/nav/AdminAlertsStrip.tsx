"use client";

import { useEffect, useState } from "react";
import { useGameTurnStatus } from "@/hooks/useGameEvents";

interface AdminAlert {
  key: string;
  severity: "error" | "warning";
  text: string;
  /** Optional deep link (tab/sub query string) applied via the nav callback. */
  target?: { tab: string; sub?: string };
}

interface AdminAlertsStripProps {
  onNavigate: (tab: string, sub?: string) => void;
}

/** Consolidated alert strip under the status bar: cron auto-pause, stale
 * processing lock, and game-health warnings from the latest snapshot.
 * Dismissible for the rest of the session; renders nothing when healthy. */
export function AdminAlertsStrip({ onNavigate }: AdminAlertsStripProps) {
  const status = useGameTurnStatus();
  const [dismissed, setDismissed] = useState(false);
  const [health, setHealth] = useState<{ warnings: number; errors: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/admin/health/snapshots/latest", { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        const tp = data?.snapshot?.turnProcessing;
        if (!cancelled && tp) {
          setHealth({ warnings: tp.warningCount ?? 0, errors: tp.errorCount ?? 0 });
        }
      })
      .catch((err) => {
        // Strip is advisory — degrade silently but keep the error observable.
        console.debug("admin alerts health fetch failed", err);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const alerts: AdminAlert[] = [];
  if (status?.pauseKind === "auto-drift") {
    alerts.push({
      key: "auto-drift",
      severity: "error",
      text: status.pauseReason ?? "Cron auto-paused: turn processing drifted behind real time",
      target: { tab: "dashboard" },
    });
  }
  if (status?.canResetProcessingLock) {
    const target = status.processingTargetTurn;
    alerts.push({
      key: "stale-lock",
      severity: "error",
      text: `Processing lock stale${target ? ` on turn ${target.toLocaleString("en-US")}` : ""} — reset it from Turn controls`,
      target: { tab: "dashboard" },
    });
  }
  if (health && (health.errors > 0 || health.warnings > 0)) {
    alerts.push({
      key: "health",
      severity: health.errors > 0 ? "error" : "warning",
      text: `Game-health checks: ${health.errors > 0 ? `${health.errors} error${health.errors === 1 ? "" : "s"}, ` : ""}${health.warnings} warning${health.warnings === 1 ? "" : "s"} last turn`,
      target: { tab: "system", sub: "game-health" },
    });
  }

  if (dismissed || alerts.length === 0) return null;

  const worst = alerts.some((a) => a.severity === "error") ? "error" : "warning";
  const frame =
    worst === "error" ? "border-error/30 bg-error/10" : "border-warning/30 bg-warning/10";

  return (
    <div className={`flex items-center gap-3 border-b px-3 py-1.5 text-body-sm sm:px-4 ${frame}`}>
      <span
        className={`shrink-0 rounded px-1.5 py-px text-body-xs font-bold tracking-wider uppercase ${
          worst === "error" ? "bg-error/20 text-error" : "bg-warning/20 text-warning"
        }`}
      >
        Alerts
      </span>
      <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden whitespace-nowrap">
        {alerts.map((a, i) => (
          <span key={a.key} className="flex min-w-0 items-center gap-2">
            {i > 0 && <span className="text-muted">·</span>}
            <button
              type="button"
              onClick={() => a.target && onNavigate(a.target.tab, a.target.sub)}
              className={`cursor-pointer truncate font-semibold hover:underline ${
                a.severity === "error" ? "text-error" : "text-warning"
              }`}
            >
              {a.text}
            </button>
          </span>
        ))}
      </div>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        className="shrink-0 cursor-pointer px-1 text-muted transition-colors hover:text-foreground"
        aria-label="Dismiss alerts"
      >
        ×
      </button>
    </div>
  );
}
