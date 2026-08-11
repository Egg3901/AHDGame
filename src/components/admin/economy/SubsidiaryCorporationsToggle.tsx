"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Admin enable/disable toggle for the subsidiary-corporations system.
 * Self-contained: reads and writes /api/admin/corporations/subsidiaries/toggle.
 */
export function SubsidiaryCorporationsToggle() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/corporations/subsidiaries/toggle");
      if (!res.ok) return;
      const data = await res.json();
      setEnabled(data.subsidiaryCorporationsEnabled === true);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggle() {
    if (enabled === null) return;
    setBusy(true);
    setErr("");
    try {
      const res = await fetch("/api/admin/corporations/subsidiaries/toggle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !enabled }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErr(data.error || "Toggle failed");
        return;
      }
      setEnabled(data.subsidiaryCorporationsEnabled === true);
    } catch {
      setErr("Network error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-card-border bg-card p-4 space-y-2">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Subsidiary corporations</h3>
          <p className="text-xs text-muted">
            Acquisition management + spin-off. Default off. When off, mutate routes 403 and the turn
            processor skips subsidiary cleanup.
          </p>
        </div>
        <button
          type="button"
          onClick={toggle}
          disabled={busy || enabled === null}
          className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50 ${
            enabled ? "bg-error hover:bg-error/90" : "bg-primary hover:bg-primary/90"
          }`}
        >
          {enabled === null ? "…" : busy ? "Working…" : enabled ? "Disable" : "Enable"}
        </button>
      </div>
      {err && <p className="text-xs text-error">{err}</p>}
    </div>
  );
}
