"use client";

import { useState, useEffect, useCallback } from "react";

type MaintenanceMode = "off" | "partial" | "full";

interface MaintenanceStatus {
  mode: MaintenanceMode;
  enabled: boolean;
  reason: string;
  expectedEnd: string;
  enabledBy: string;
  enabledAt: string;
}

const MODE_META: Record<
  MaintenanceMode,
  { label: string; description: string; badgeText: string }
> = {
  off: {
    label: "Off",
    description: "Normal operation.",
    badgeText: "Off",
  },
  partial: {
    label: "Partial",
    description:
      "Site stays browsable with a banner; registration and character creation are blocked.",
    badgeText: "Partial",
  },
  full: {
    label: "Full",
    description: "Entire site redirects to the maintenance page except admins.",
    badgeText: "Full",
  },
};

/** Semantic status color per mode — off reads as success (normal), partial
 *  as warning (degraded but browsable), full as error (hard lockout). */
const MODE_COLOR: Record<MaintenanceMode, { fg: string; bgSoft: string; border: string }> = {
  off: { fg: "var(--success)", bgSoft: "rgba(34, 197, 94, 0.15)", border: "var(--card-border)" },
  partial: { fg: "var(--warning)", bgSoft: "rgba(234, 179, 8, 0.15)", border: "var(--warning)" },
  full: { fg: "var(--error)", bgSoft: "rgba(239, 68, 68, 0.15)", border: "var(--error)" },
};

export function MaintenanceModePanel() {
  const [status, setStatus] = useState<MaintenanceStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState(false);
  const [targetMode, setTargetMode] = useState<MaintenanceMode>("off");
  const [reason, setReason] = useState("");
  const [durationMinutes, setDurationMinutes] = useState(30);
  const [error, setError] = useState("");

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/maintenance");
      if (res.ok) {
        const data = await res.json();
        setStatus(data);
        setTargetMode(data.mode ?? "off");
        if (data.mode !== "off" && data.reason) setReason(data.reason);
      }
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  const handleApply = async () => {
    setToggling(true);
    setError("");

    try {
      const body: Record<string, unknown> = { mode: targetMode };
      if (targetMode !== "off") {
        body.reason = reason;
        if (durationMinutes > 0) {
          const end = new Date(Date.now() + durationMinutes * 60 * 1000);
          body.expectedEnd = end.toISOString();
        }
      }

      const res = await fetch("/api/admin/maintenance", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Failed to update maintenance mode");
        return;
      }

      await fetchStatus();
      if (targetMode === "off") setReason("");
    } catch {
      setError("Network error");
    } finally {
      setToggling(false);
    }
  };

  if (loading) {
    return (
      <div className="rounded-xl border border-card-border bg-card p-6 shadow-card">
        <div className="flex items-center gap-2">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <span className="text-sm text-muted">Loading maintenance status...</span>
        </div>
      </div>
    );
  }

  const currentMode = status?.mode ?? "off";
  const currentColor = MODE_COLOR[currentMode];
  const targetColor = MODE_COLOR[targetMode];
  const isDirty = targetMode !== currentMode;

  return (
    <div
      className="rounded-xl border bg-card p-6 shadow-card"
      style={{
        borderColor: currentMode === "off" ? "var(--card-border)" : currentColor.border,
        borderLeftWidth: "3px",
      }}
    >
      {/* Header */}
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div
            className="flex h-9 w-9 items-center justify-center rounded-lg"
            style={{ background: currentColor.bgSoft }}
          >
            <svg
              className="h-5 w-5"
              style={{ color: currentColor.fg }}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M11.42 15.17L17.25 21A2.652 2.652 0 0021 17.25l-5.877-5.877M11.42 15.17l2.496-3.03c.317-.384.74-.626 1.208-.766M11.42 15.17l-4.655 5.653a2.548 2.548 0 11-3.586-3.586l6.837-5.63m5.108-.233c.55-.164 1.163-.188 1.743-.14a4.5 4.5 0 004.486-6.336l-3.276 3.277a3.004 3.004 0 01-2.25-2.25l3.276-3.276a4.5 4.5 0 00-6.336 4.486c.091 1.076-.071 2.264-.904 2.95l-.102.085m-1.745 1.437L5.909 7.5H4.5L2.25 3.75l1.5-1.5L7.5 4.5v1.409l4.26 4.26m-1.745 1.437l1.745-1.437m6.615 8.206L15.75 15.75M4.867 19.125h.008v.008h-.008v-.008z"
              />
            </svg>
          </div>
          <div>
            <h3 className="text-sm font-semibold">Maintenance Mode</h3>
            <p className="text-xs text-muted">{MODE_META[currentMode].description}</p>
          </div>
        </div>

        {/* Status badge */}
        <span
          className="rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider"
          style={{ background: currentColor.bgSoft, color: currentColor.fg }}
        >
          {MODE_META[currentMode].badgeText}
        </span>
      </div>

      {/* Enabled info */}
      {currentMode !== "off" && status?.enabledBy && (
        <div
          className="mb-4 rounded-lg border p-3 text-xs text-muted"
          style={{ borderColor: `${currentColor.fg}33`, background: currentColor.bgSoft }}
        >
          Set by <span className="font-medium text-foreground">{status.enabledBy}</span>
          {status.enabledAt && (
            <>
              {" "}
              at{" "}
              <span className="font-medium text-foreground">
                {new Date(status.enabledAt).toLocaleString("en-US")}
              </span>
            </>
          )}
        </div>
      )}

      {/* 3-way mode selector */}
      <div className="mb-4">
        <span className="mb-1.5 block text-xs font-medium text-muted">Set mode</span>
        <div className="inline-flex rounded-lg border border-card-border p-1">
          {(Object.keys(MODE_META) as MaintenanceMode[]).map((mode) => {
            const active = targetMode === mode;
            const color = MODE_COLOR[mode];
            return (
              <button
                key={mode}
                type="button"
                onClick={() => setTargetMode(mode)}
                className="rounded-md px-3 py-1.5 text-xs font-semibold transition-colors"
                style={
                  active ? { background: color.bgSoft, color: color.fg } : { color: "var(--muted)" }
                }
              >
                {MODE_META[mode].label}
              </button>
            );
          })}
        </div>
        <p className="mt-1.5 text-[11px] text-muted">{MODE_META[targetMode].description}</p>
      </div>

      {/* Controls — only show form when the target mode is not "off" */}
      {targetMode !== "off" && (
        <div className="mb-4 space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-muted" htmlFor="maint-reason">
              Reason (shown to players)
            </label>
            <input
              id="maint-reason"
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Deploying v2.5 with new election system..."
              maxLength={500}
              className="w-full rounded-lg border border-card-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted/50 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-muted" htmlFor="maint-duration">
              Expected Duration (minutes)
            </label>
            <div className="flex items-center gap-2">
              <input
                id="maint-duration"
                type="number"
                value={durationMinutes}
                onChange={(e) => setDurationMinutes(Math.max(0, parseInt(e.target.value) || 0))}
                min={0}
                max={1440}
                className="w-28 rounded-lg border border-card-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              />
              <div className="flex gap-1.5">
                {[15, 30, 60, 120].map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setDurationMinutes(m)}
                    className="rounded-md border border-card-border px-2 py-1 text-xs text-muted transition-colors hover:border-muted/40 hover:text-foreground"
                    style={
                      durationMinutes === m
                        ? { borderColor: "var(--primary)", color: "var(--primary)" }
                        : {}
                    }
                  >
                    {m < 60 ? `${m}m` : `${m / 60}h`}
                  </button>
                ))}
              </div>
            </div>
            <p className="mt-1 text-[10px] text-muted/60">Set to 0 for no countdown timer</p>
          </div>
        </div>
      )}

      {error && (
        <div className="mb-3 rounded-lg border border-error/30 bg-error/10 p-2 text-xs text-error">
          {error}
        </div>
      )}

      {/* Apply button */}
      <button
        type="button"
        onClick={handleApply}
        disabled={toggling || !isDirty}
        className="inline-flex h-9 items-center gap-2 rounded-lg px-4 text-sm font-medium text-white transition-colors disabled:opacity-50"
        style={{ background: targetMode === "off" ? "var(--success)" : targetColor.fg }}
      >
        {toggling ? (
          <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
        ) : (
          <svg
            className="h-4 w-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        )}
        {toggling
          ? "Updating..."
          : !isDirty
            ? `Currently ${MODE_META[currentMode].label}`
            : `Apply "${MODE_META[targetMode].label}"`}
      </button>
    </div>
  );
}
