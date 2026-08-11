"use client";

import { useState } from "react";
import { PlayerSelector } from "@/components/PlayerSelector";

interface AppointSubsidiaryCeoModalProps {
  corporationId: string;
  corporationName: string;
  onClose: () => void;
  onAppointed: () => void;
}

/**
 * Parent CEO reseats a subsidiary's CEO — either a human character (chosen by
 * name search) or an NPP caretaker. Ineligible humans (the parent owner / CEO /
 * a sibling subsidiary's operator) are rejected server-side by the one-person
 * rule, and the error is surfaced inline if the chosen player isn't allowed.
 */
export function AppointSubsidiaryCeoModal({
  corporationId,
  corporationName,
  onClose,
  onAppointed,
}: AppointSubsidiaryCeoModalProps) {
  const [ceoType, setCeoType] = useState<"npp" | "character">("npp");
  const [selected, setSelected] = useState<{ id: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function handleSubmit() {
    setBusy(true);
    setErr("");
    try {
      const res = await fetch(`/api/corporations/${corporationId}/subsidiary/appoint-ceo`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          ceoType === "character" ? { ceoType, characterId: selected?.id } : { ceoType }
        ),
      });
      const data = await res.json();
      if (!res.ok) {
        setErr(data.error || "Failed to appoint CEO");
        return;
      }
      onAppointed();
    } catch {
      setErr("Network error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-xl border border-card-border bg-card p-5 space-y-4">
        <h2 className="text-base font-bold text-foreground">Appoint CEO — {corporationName}</h2>
        <p className="text-xs text-muted">
          A subsidiary must be operated by a different player than the parent, or by an NPP
          caretaker.
        </p>

        <div className="space-y-2">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="ceoType"
              checked={ceoType === "npp"}
              onChange={() => setCeoType("npp")}
            />
            NPP caretaker (auto-selected)
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="ceoType"
              checked={ceoType === "character"}
              onChange={() => setCeoType("character")}
            />
            Player character
          </label>
        </div>

        {ceoType === "character" && (
          <div className="space-y-2">
            <PlayerSelector
              placeholder="Search for a player by name…"
              onSelect={(c) => {
                setSelected({ id: c.id, name: c.name });
                setErr("");
              }}
            />
            {selected && (
              <p className="text-xs text-muted">
                Selected: <span className="font-semibold text-foreground">{selected.name}</span>
              </p>
            )}
          </div>
        )}

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
            disabled={busy || (ceoType === "character" && !selected)}
            className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white hover:bg-primary/90 disabled:opacity-50"
          >
            {busy ? "Working…" : "Appoint CEO"}
          </button>
        </div>
      </div>
    </div>
  );
}
