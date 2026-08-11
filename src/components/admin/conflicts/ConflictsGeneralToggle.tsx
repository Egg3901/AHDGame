"use client";
import { useEffect, useState } from "react";
import { fetchJson } from "@/lib/observability/fetchJson";

const ENDPOINT = "/api/admin/conflicts/general/toggle";

/**
 * Enable/disable switch for the Conflicts subsystem (`conflictsEnabled`).
 * While enabled, the "Conflicts" link appears in the World navbar and the
 * /world/conflicts page is surfaced to players. Admin-only.
 */
export function ConflictsGeneralToggle() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [enabledBy, setEnabledBy] = useState<string | null>(null);
  const [enabledAt, setEnabledAt] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    fetch(ENDPOINT)
      .then((r) => r.json())
      .then((d) => {
        setEnabled(Boolean(d.enabled));
        setEnabledBy(d.enabledBy ?? null);
        setEnabledAt(d.enabledAt ?? null);
      })
      .catch(() => setMessage("Could not load Conflicts flag state."));
  }, []);

  async function toggle() {
    if (enabled === null || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !enabled }),
      });
      const data = await res.json();
      if (res.ok) {
        const next = Boolean(data.conflictsEnabled);
        setEnabled(next);
        setMessage(
          next
            ? "Conflicts enabled. The World navbar link is now visible to players."
            : "Conflicts disabled. The World navbar link is hidden."
        );
        // Refresh attribution metadata after the change.
        fetchJson<{ enabledBy?: string | null; enabledAt?: string | null }>(ENDPOINT, {
          feature: "admin-conflicts-toggle",
        })
          .then((d) => {
            setEnabledBy(d.enabledBy ?? null);
            setEnabledAt(d.enabledAt ?? null);
          })
          .catch(() => {});
      } else {
        setMessage(data.error ?? "Failed to update flag.");
      }
    } catch {
      setMessage("Failed to update flag.");
    } finally {
      setBusy(false);
    }
  }

  const on = enabled === true;
  return (
    <div className="rounded-xl border border-card-border bg-card p-4 shadow-card">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="font-serif text-lg text-foreground">Conflicts</h3>
          <p className="mt-0.5 max-w-xl text-sm text-muted">
            Enable the Conflicts subsystem. While enabled, the{" "}
            <span className="font-medium text-foreground">Conflicts</span> link appears in the World
            navbar and the public Conflicts page is surfaced to players.
          </p>
          {on && enabledBy && (
            <p className="mt-2 text-xs text-muted">
              Enabled by <span className="font-medium text-foreground">{enabledBy}</span>
              {enabledAt ? ` on ${new Date(enabledAt).toLocaleString("en-US")}` : ""}.
            </p>
          )}
          {message && <p className="mt-2 text-sm text-muted">{message}</p>}
        </div>
        <button
          onClick={toggle}
          disabled={enabled === null || busy}
          className={`inline-flex shrink-0 items-center justify-center rounded-lg border px-4 py-2 text-sm font-semibold transition-colors disabled:opacity-50 ${
            on
              ? "border-primary/50 bg-primary/10 text-primary hover:bg-primary/20"
              : "border-card-border bg-background text-muted hover:bg-card-border/20"
          }`}
          title="Toggle the Conflicts subsystem on or off."
        >
          {enabled === null ? "Loading…" : `${on ? "Enabled" : "Disabled"}${busy ? "…" : ""}`}
        </button>
      </div>
    </div>
  );
}
