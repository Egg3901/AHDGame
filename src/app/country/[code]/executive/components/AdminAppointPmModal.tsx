"use client";

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { useToast } from "@/contexts/ToastContext";

interface AppointCharacter {
  _id: string;
  name: string;
  party: string;
  countryId: string;
  homeState: string;
  currentOffice: unknown;
  sequentialId?: number;
}

export function AdminAppointPmButton({ countryId }: { countryId: string }) {
  const { showToast } = useToast();
  const [open, setOpen] = useState(false);
  const [characters, setCharacters] = useState<AppointCharacter[]>([]);
  const [selectedCharId, setSelectedCharId] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    fetch(`/api/admin/officials/appoint?countryId=${countryId}`)
      .then((r) => (r.ok ? r.json() : { characters: [] }))
      .then((d) => setCharacters(d.characters ?? []))
      .catch(() => setCharacters([]));
  }, [open, countryId]);

  const handleAppoint = async () => {
    setSubmitting(true);
    try {
      const res = await fetch("/api/admin/uk/government/appoint-pm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ characterId: selectedCharId || null, countryId }),
      });
      const json = await res.json();
      if (res.ok) {
        showToast(json.message ?? "Appointment updated", "success");
        setOpen(false);
        setSelectedCharId("");
        // Reload to reflect server component changes
        window.location.reload();
      } else {
        showToast(json.error ?? "Failed to update appointment", "error");
      }
    } catch {
      showToast("Network error — please try again", "error");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-1.5 text-xs font-semibold text-warning hover:bg-warning/20 transition-colors"
      >
        Appoint PM (Admin)
      </button>

      {open &&
        createPortal(
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div className="w-full max-w-md rounded-xl border border-card-border bg-card p-6 shadow-modal">
              <h3 className="text-lg font-semibold mb-4">Appoint Prime Minister</h3>
              <p className="text-sm text-muted mb-4">
                Only player characters can serve. NPPs cannot be appointed.
              </p>
              <label htmlFor="appoint-pm-character" className="block text-sm font-medium mb-2">
                Select character
              </label>
              <select
                id="appoint-pm-character"
                value={selectedCharId}
                onChange={(e) => setSelectedCharId(e.target.value)}
                className="w-full rounded-lg border border-card-border bg-background px-3 py-2 text-sm mb-4"
              >
                <option value="">— Vacate position —</option>
                {characters.map((c) => (
                  <option key={c._id} value={c._id}>
                    {c.name} ({c.sequentialId ?? ""}) — {c.homeState}
                    {c.currentOffice ? " [Has office]" : ""}
                  </option>
                ))}
              </select>
              <div className="flex justify-end gap-3">
                <button
                  onClick={() => {
                    setOpen(false);
                    setSelectedCharId("");
                  }}
                  className="rounded-lg border border-card-border px-4 py-2 text-sm hover:bg-card-elevated transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleAppoint}
                  disabled={submitting}
                  className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-50 transition-colors"
                >
                  {selectedCharId ? "Appoint" : "Vacate"}
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
