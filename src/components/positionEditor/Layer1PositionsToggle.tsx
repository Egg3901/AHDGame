"use client";
import { useEffect, useState } from "react";

const ENDPOINT = "/api/admin/demographics/layer1-positions/toggle";

/**
 * Admin toggle for the gated Layer-1 position model
 * (`demographicsLayer1PositionsEnabled`). Flipping it does not retroactively
 * change live data — a reseed (or world reset) applies the change — so the
 * control surfaces that reminder rather than implying an instant effect.
 */
export function Layer1PositionsToggle() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    fetch(ENDPOINT)
      .then((r) => r.json())
      .then((d) => setEnabled(Boolean(d.enabled)))
      .catch(() => setMessage("Could not load flag state"));
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
        setEnabled(Boolean(data.demographicsLayer1PositionsEnabled));
        setMessage(
          data.note ?? (data.demographicsLayer1PositionsEnabled ? "Enabled." : "Disabled.")
        );
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
    <div className="flex flex-wrap items-center gap-3">
      <button
        onClick={toggle}
        disabled={enabled === null || busy}
        className={`rounded-lg border px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50 ${
          on
            ? "border-primary/50 bg-primary/10 text-primary hover:bg-primary/20"
            : "border-card-border bg-background text-muted hover:bg-card-border/20"
        }`}
        title="Toggle the gated Layer-1 position model. Takes effect on the next reseed / world reset."
      >
        {enabled === null
          ? "Layer-1 positions…"
          : `Layer-1 positions: ${on ? "ON" : "OFF"}${busy ? "…" : ""}`}
      </button>
      {message && <span className="text-sm text-muted">{message}</span>}
    </div>
  );
}
