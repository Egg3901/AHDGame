"use client";

import { useEffect, useState } from "react";
import type { CorporationDetail } from "../CorporationPageTypes";

/**
 * Hand day-to-day operation of the corp to an autonomous NPP caretaker, or
 * reclaim it (NPP-autonomy V2.1). Only rendered where caretakers are enabled for
 * the corp's country (v2). The owner keeps control throughout — this just swaps
 * who runs the turns.
 */
export function CaretakerCeoCard({
  corporation,
  corpId,
  onRefresh,
}: {
  corporation: CorporationDetail;
  corpId: string;
  onRefresh: () => void;
}) {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/npps/eligible-caretakers?country=${corporation.countryId}`)
      .then((res) => res.json())
      .then((data: { enabled?: boolean }) => {
        if (!cancelled) setEnabled(data.enabled === true);
      })
      .catch(() => {
        if (!cancelled) setEnabled(false);
      });
    return () => {
      cancelled = true;
    };
  }, [corporation.countryId]);

  if (!enabled) return null;

  // A caretaker (NPP) runs the corp when the seat is filled but by no character.
  const isCaretakerRun = !corporation.ceoVacant && !corporation.ceoCharacterId;

  async function appoint() {
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      const res = await fetch(`/api/corporations/${corpId}/ceo/caretaker`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (res.ok) {
        setSuccess(`${data.nppName ?? "An NPP caretaker"} now runs the corporation.`);
        onRefresh();
      } else {
        setError((data as { error?: string }).error ?? "Failed to appoint caretaker");
      }
    } catch {
      setError("Network error");
    } finally {
      setBusy(false);
    }
  }

  async function dismiss() {
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      const res = await fetch(`/api/corporations/${corpId}/ceo/caretaker`, { method: "DELETE" });
      const data = await res.json();
      if (res.ok) {
        setSuccess("You have resumed control of the corporation.");
        onRefresh();
      } else {
        setError((data as { error?: string }).error ?? "Failed to dismiss caretaker");
      }
    } catch {
      setError("Network error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-card-border bg-card p-6">
      <h2 className="text-lg font-bold text-foreground mb-2">NPP Caretaker</h2>
      <p className="text-sm text-muted mb-4">
        {isCaretakerRun
          ? "An autonomous NPP caretaker is running this corporation on your behalf. You remain the owner and can resume control at any time."
          : "Hand day-to-day operation to an autonomous NPP caretaker. It runs the corporation under the same bounded rules as any AI-run corp; you stay the owner and can reclaim it anytime."}
      </p>
      {error && (
        <div className="rounded-lg border border-error/30 bg-error/10 p-3 text-sm text-error mb-3">
          {error}
        </div>
      )}
      {success && (
        <div className="rounded-lg border border-success/30 bg-success/10 p-3 text-sm text-success mb-3">
          {success}
        </div>
      )}
      {isCaretakerRun ? (
        <button
          onClick={dismiss}
          disabled={busy}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90 transition-colors disabled:opacity-50"
        >
          {busy ? "Resuming…" : "Resume Control"}
        </button>
      ) : (
        <button
          onClick={appoint}
          disabled={busy}
          className="rounded-lg border border-card-border px-4 py-2 text-sm font-medium text-foreground hover:bg-card-elevated transition-colors disabled:opacity-50"
        >
          {busy ? "Appointing…" : "Hand to NPP Caretaker"}
        </button>
      )}
    </div>
  );
}
