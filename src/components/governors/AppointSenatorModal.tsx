"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui";

interface Candidate {
  appointeeId: string;
  appointeeType: "character" | "npp";
  characterId: string;
  name: string;
  party: string;
  homeState: string;
}

interface AppointSenatorModalProps {
  state: string;
  senateClass: number;
  onClose: () => void;
}

export default function AppointSenatorModal({
  state,
  senateClass,
  onClose,
}: AppointSenatorModalProps) {
  const router = useRouter();
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [selectedCandidate, setSelectedCandidate] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fetchingCandidates, setFetchingCandidates] = useState(true);

  useEffect(() => {
    async function fetchCandidates() {
      try {
        const res = await fetch(`/api/governors/eligible-appointees?senateClass=${senateClass}`);
        const data = await res.json();

        if (!res.ok) {
          throw new Error(data.error || "Failed to fetch candidates");
        }

        setCandidates(data.candidates ?? []);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load candidates");
      } finally {
        setFetchingCandidates(false);
      }
    }

    fetchCandidates();
  }, [senateClass]);

  const handleAppoint = async () => {
    if (!selectedCandidate) {
      setError("Please select a candidate");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const [appointeeType, appointeeId] = selectedCandidate.split(":");
      const res = await fetch("/api/governors/appoint-senator", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          appointeeId,
          appointeeType,
          senateClass,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to appoint senator");
      }

      router.refresh();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal open title={`Appoint US Senator for ${state}`} onClose={onClose}>
      <div className="mb-4 space-y-2">
        <p className="text-sm text-muted">
          <strong className="text-foreground">Vacancy:</strong> Class {senateClass} Senate seat
        </p>
        <p className="text-sm text-muted">
          <strong className="text-foreground">Term:</strong> Until next Class {senateClass} election
        </p>
      </div>

      {fetchingCandidates ? (
        <div className="mb-4 text-sm text-muted">Loading eligible candidates...</div>
      ) : candidates.length === 0 ? (
        <div className="mb-4 rounded border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning">
          No eligible candidates found in {state}. Candidates must be players or NPPs from your
          state who do not currently hold office.
        </div>
      ) : (
        <div className="mb-4">
          <label className="mb-2 block text-sm font-medium text-foreground">
            Select Appointee:
          </label>
          <select
            value={selectedCandidate}
            onChange={(e) => setSelectedCandidate(e.target.value)}
            className="w-full rounded-lg border border-card-border bg-background px-3 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
          >
            <option value="">-- Select a candidate --</option>
            {candidates.map((candidate) => (
              <option
                key={`${candidate.appointeeType}:${candidate.appointeeId}`}
                value={`${candidate.appointeeType}:${candidate.appointeeId}`}
              >
                {candidate.name} ({candidate.party}
                {candidate.appointeeType === "npp" ? ", NPP" : ""})
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="mb-4 rounded border border-info/30 bg-info/10 px-3 py-2 text-sm text-info">
        Note: Appointed senator serves until the next Class {senateClass} election.
      </div>

      {error && (
        <div className="mb-4 rounded border border-error/30 bg-error/10 px-3 py-2 text-sm text-error">
          {error}
        </div>
      )}

      <div className="flex gap-2">
        <button
          onClick={onClose}
          disabled={loading}
          className="flex-1 rounded-lg border border-card-border bg-card px-4 py-2 text-sm font-medium text-foreground hover:bg-card-elevated disabled:opacity-50 transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={handleAppoint}
          disabled={loading || candidates.length === 0}
          className="flex-1 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-dark disabled:opacity-50 transition-colors"
        >
          {loading ? "Appointing..." : "Confirm Appointment"}
        </button>
      </div>
    </Modal>
  );
}
