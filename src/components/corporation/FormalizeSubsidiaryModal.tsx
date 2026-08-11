"use client";

import { useState } from "react";

interface FormalizeSubsidiaryModalProps {
  /** The target corp being formalized (route param). */
  corporationId: string;
  corporationName: string;
  /** The controlling parent corp id (>50% voting). */
  parentCorporationId: string;
  parentName: string;
  onClose: () => void;
  onFormalized: () => void;
}

/**
 * Shown on a target corp page when the viewer is the CEO of the corp controlling
 * >50% of its voting power. Formalizes the managed-subsidiary relationship, then
 * hands off to appoint-CEO.
 */
export function FormalizeSubsidiaryModal({
  corporationId,
  corporationName,
  parentCorporationId,
  parentName,
  onClose,
  onFormalized,
}: FormalizeSubsidiaryModalProps) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function handleSubmit() {
    setBusy(true);
    setErr("");
    try {
      const res = await fetch(`/api/corporations/${corporationId}/subsidiary/formalize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parentCorporationId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErr(data.error || "Failed to formalize subsidiary");
        return;
      }
      onFormalized();
    } catch {
      setErr("Network error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-xl border border-card-border bg-card p-5 space-y-4">
        <h2 className="text-base font-bold text-foreground">Formalize subsidiary</h2>
        <p className="text-sm text-foreground">
          Formalize <span className="font-semibold">{corporationName}</span> as a managed subsidiary
          of <span className="font-semibold">{parentName}</span>?
        </p>
        <p className="text-xs text-muted">
          {corporationName} stays a separate corporation with its own sectors, share price, and
          shareholders. As parent CEO you may appoint its CEO, inject capital, and set a dividend
          floor — but its day-to-day is run by a different CEO.
        </p>
        {err && <p className="text-xs text-error">{err}</p>}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-card-border px-3 py-1.5 text-xs font-semibold"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={busy}
            className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white hover:bg-primary/90 disabled:opacity-50"
          >
            {busy ? "Working…" : "Formalize"}
          </button>
        </div>
      </div>
    </div>
  );
}
