"use client";

import { useState, useEffect } from "react";
import { Modal } from "@/components/ui";

interface PMCandidate {
  _id: string;
  name: string;
  partyName: string;
}

interface AppointPMModalProps {
  countryCode: string;
  open: boolean;
  onClose: () => void;
  onSuccess?: (voteId: string) => void;
  executiveTitle?: string;
  /**
   * API path segment under /api/country/[code]/ serving GET candidates +
   * POST nominate. Defaults to the PM flow; the head-of-state appointment
   * (RU Chairman of the Presidium) passes "hos/appoint".
   */
  endpointPath?: string;
}

export default function AppointPMModal({
  countryCode,
  open,
  onClose,
  onSuccess,
  executiveTitle = "Prime Minister",
  endpointPath = "pm/appoint",
}: AppointPMModalProps) {
  const [candidates, setCandidates] = useState<PMCandidate[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loadingCandidates, setLoadingCandidates] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;

    setSelectedId(null);
    setError(null);
    setLoadingCandidates(true);

    fetch(`/api/country/${countryCode}/${endpointPath}`)
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Failed to load candidates.");
        return data;
      })
      .then((data) => {
        setCandidates(
          (data.candidates ?? []).sort((a: PMCandidate, b: PMCandidate) =>
            a.name.localeCompare(b.name)
          )
        );
      })
      .catch((err: Error) => {
        setError(err.message);
      })
      .finally(() => {
        setLoadingCandidates(false);
      });
  }, [open, countryCode, endpointPath]);

  const handleNominate = async () => {
    if (!selectedId) return;

    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/country/${countryCode}/${endpointPath}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nomineeCharacterId: selectedId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to nominate candidate.");
      } else {
        onSuccess?.(data.voteId ?? "");
        onClose();
      }
    } catch {
      setError("Network error.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={open} title={`Nominate a ${executiveTitle}`} onClose={onClose}>
      {loadingCandidates ? (
        <p className="mb-4 text-sm text-muted">Loading candidates…</p>
      ) : error ? (
        <p className="mb-4 text-sm text-error">{error}</p>
      ) : candidates.length === 0 ? (
        <p className="mb-4 text-sm text-muted italic">
          No eligible candidates available at this time.
        </p>
      ) : (
        <div className="mb-4">
          <select
            value={selectedId ?? ""}
            onChange={(e) => setSelectedId(e.target.value || null)}
            className="w-full rounded-lg border border-card-border bg-background px-4 py-3 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          >
            <option value="">Select a candidate…</option>
            {candidates.map((c) => (
              <option key={c._id} value={c._id}>
                {c.name} — {c.partyName}
              </option>
            ))}
          </select>
        </div>
      )}

      {error && !loadingCandidates && candidates.length > 0 && (
        <p className="mb-3 text-sm text-error">{error}</p>
      )}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={onClose}
          disabled={submitting}
          className="flex-1 rounded-lg border border-card-border bg-background px-4 py-2 text-sm font-medium hover:bg-muted/10 disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleNominate}
          disabled={!selectedId || submitting || loadingCandidates}
          className="flex-1 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary/90 disabled:opacity-50"
        >
          {submitting ? "Nominating…" : "Nominate"}
        </button>
      </div>
    </Modal>
  );
}
