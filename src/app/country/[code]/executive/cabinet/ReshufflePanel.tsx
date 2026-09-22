"use client";

import { useState } from "react";
import { Button } from "@/components/ui";
import { useToast } from "@/contexts/ToastContext";
import { executiveApiUrl } from "@/lib/urls";

export interface ReshuffleCandidate {
  _id: string;
  name: string;
  constituency: string;
  partyName?: string;
  party?: string;
}

export interface ReshuffleSeat {
  id: string;
  name: string;
  isHeadOfGovernment?: boolean;
  member: { characterName: string; isNPP?: boolean } | null;
}

interface ReshufflePanelProps {
  countryId: string;
  seats: ReshuffleSeat[];
  available: boolean;
  reason: string;
  isPrimeMinister: boolean;
  candidates: ReshuffleCandidate[];
  candidatesLoading: boolean;
  onLoadCandidates: () => void;
  onSubmitted: () => void;
}

/**
 * PM reshuffle surface (issue #859): shows the once-per-parliament token
 * state, plus a full-roster editor (while the token is unspent) that posts
 * the complete new lineup to POST /cabinet/reshuffle in one action.
 * NPP-held seats are preserved server-side and shown read-only here.
 */
export function ReshufflePanel({
  countryId,
  seats,
  available,
  reason,
  isPrimeMinister,
  candidates,
  candidatesLoading,
  onLoadCandidates,
  onSubmitted,
}: ReshufflePanelProps) {
  const { showToast } = useToast();
  const [editorOpen, setEditorOpen] = useState(false);
  const [selections, setSelections] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const portfolioSeats = seats.filter((seat) => !seat.isHeadOfGovernment);

  const openEditor = () => {
    setSelections({});
    setError(null);
    setEditorOpen(true);
    onLoadCandidates();
  };

  const handleSubmit = async () => {
    const appointments = Object.entries(selections)
      .filter(([, characterId]) => characterId !== "")
      .map(([positionId, characterId]) => ({ positionId, characterId }));

    if (appointments.length === 0) {
      setError("Select at least one minister for the new cabinet.");
      return;
    }
    const seen = new Set<string>();
    for (const { characterId } of appointments) {
      if (seen.has(characterId)) {
        setError("Each minister can only hold one cabinet seat.");
        return;
      }
      seen.add(characterId);
    }

    if (
      !confirm(
        `Reshape the cabinet now with ${appointments.length} new minister${appointments.length === 1 ? "" : "s"}? Vacated seats are left empty. This can only be done once per parliament.`
      )
    ) {
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`${executiveApiUrl(countryId)}/cabinet/reshuffle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appointments }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        showToast(data.message ?? "Cabinet reshuffled", "success");
        setEditorOpen(false);
        setSelections({});
        onSubmitted();
      } else if (res.status === 409) {
        const message = data.error ?? "The reshuffle token is already spent for this parliament.";
        setError(message);
        showToast(message, "error");
      } else if (res.status === 400) {
        const message = data.error ?? "The new roster is invalid.";
        setError(message);
        showToast(message, "error");
      } else if (res.status === 403) {
        const message = data.error ?? "Only the Prime Minister can reshuffle the cabinet.";
        setError(message);
        showToast(message, "error");
      } else {
        const message = data.error ?? "Failed to reshuffle the cabinet";
        setError(message);
        showToast(message, "error");
      }
    } catch {
      setError("An unexpected error occurred");
      showToast("An unexpected error occurred", "error");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section
      aria-labelledby="cabinet-reshuffle-heading"
      className="rounded-xl border border-card-border bg-card p-4 shadow-card sm:p-5"
    >
      <h2
        id="cabinet-reshuffle-heading"
        className="text-sm font-semibold uppercase tracking-widest text-muted"
      >
        Cabinet Reshuffle
      </h2>
      <p className="mt-2 text-sm text-foreground" aria-live="polite">
        {available ? (
          <>Reshuffle available: the whole cabinet can be replaced in one action.</>
        ) : (
          <>Reshuffle spent ({reason}). A new parliament or a new government restores it.</>
        )}
      </p>

      {isPrimeMinister && available && !editorOpen && (
        <Button
          variant="secondary"
          onClick={openEditor}
          className="mt-3"
          aria-label="Open the cabinet reshuffle editor"
        >
          Reshape Cabinet
        </Button>
      )}
      {isPrimeMinister && !available && (
        <p className="mt-2 text-sm text-muted">
          Individual ministers can still be removed with Fire; each firing dents government
          confidence.
        </p>
      )}

      {editorOpen && (
        <div className="mt-4 space-y-3">
          {error && (
            <p
              role="alert"
              className="rounded-lg border border-error/30 bg-error/10 p-3 text-sm text-error"
            >
              {error}
            </p>
          )}
          {candidatesLoading ? (
            <p className="text-sm text-muted" aria-live="polite">
              Loading eligible candidates...
            </p>
          ) : candidates.length === 0 ? (
            <p className="text-sm text-muted">No eligible candidates found.</p>
          ) : (
            <ul className="space-y-2">
              {portfolioSeats.map((seat) => (
                <li
                  key={seat.id}
                  className="flex flex-col gap-1 rounded-lg border border-card-border p-3 sm:flex-row sm:items-center sm:gap-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-foreground">{seat.name}</p>
                    <p className="text-xs text-muted">
                      {seat.member?.isNPP
                        ? `Held by ${seat.member.characterName} (NPP): unchanged by a reshuffle`
                        : seat.member
                          ? `Currently ${seat.member.characterName}`
                          : "Currently vacant"}
                    </p>
                  </div>
                  <label className="sr-only" htmlFor={`reshuffle-${seat.id}`}>
                    New minister for {seat.name}
                  </label>
                  <select
                    id={`reshuffle-${seat.id}`}
                    value={selections[seat.id] ?? ""}
                    disabled={submitting || seat.member?.isNPP === true}
                    onChange={(e) =>
                      setSelections((prev) => ({ ...prev, [seat.id]: e.target.value }))
                    }
                    className="rounded-lg border border-card-border bg-background px-3 py-2 text-sm text-foreground disabled:opacity-50"
                  >
                    <option value="">Leave vacant</option>
                    {candidates.map((candidate) => (
                      <option key={candidate._id} value={candidate._id}>
                        {candidate.name} ({candidate.constituency})
                      </option>
                    ))}
                  </select>
                </li>
              ))}
            </ul>
          )}
          <div className="flex gap-3">
            <Button
              variant="secondary"
              onClick={() => setEditorOpen(false)}
              disabled={submitting}
              className="flex-1"
            >
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={submitting || candidatesLoading}
              className="flex-1"
              aria-label="Submit the new cabinet roster"
            >
              {submitting ? "Reshuffling..." : "Confirm Reshuffle"}
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
