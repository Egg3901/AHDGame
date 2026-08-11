"use client";

import { useState, useTransition } from "react";
import { trackAction } from "@/lib/observability/actionBreadcrumb";
import { useRouter } from "next/navigation";

interface EndorseButtonProps {
  electionId: string;
  candidateId: string;
  alreadyEndorsed: boolean;
  /** null when viewer has no endorsement for this election; endorsed candidateId otherwise */
  viewerEndorsedCandidateId: string | null;
  canEndorse: boolean;
  partyColor?: string;
}

export function EndorseButton({
  electionId,
  candidateId,
  alreadyEndorsed,
  viewerEndorsedCandidateId,
  canEndorse,
  partyColor,
}: EndorseButtonProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");

  if (!canEndorse) return null;

  const isEndorsed = alreadyEndorsed;
  // If viewer endorsed someone else, show "Switch"
  const otherEndorsed =
    viewerEndorsedCandidateId !== null && viewerEndorsedCandidateId !== candidateId;

  const click = async () => {
    setError("");
    const action = isEndorsed ? "DELETE" : "POST";
    trackAction("election.endorse", { electionId, candidateId, action });
    const res = await fetch(`/api/elections/${electionId}/endorse`, {
      method: action,
      headers: { "Content-Type": "application/json" },
      body: action === "POST" ? JSON.stringify({ candidateId }) : undefined,
    });
    if (!res.ok) {
      try {
        const d = await res.json();
        setError(d.error ?? "Failed");
      } catch {
        setError("Failed");
      }
      return;
    }
    startTransition(() => router.refresh());
  };

  const partyButtonStyle =
    !isEndorsed && !otherEndorsed && partyColor
      ? {
          borderColor: partyColor + "66",
          color: partyColor,
          backgroundColor: partyColor + "1a",
        }
      : undefined;

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        disabled={pending}
        onClick={click}
        style={partyButtonStyle}
        className={`rounded-md border px-2 py-0.5 text-[10px] font-medium transition-colors disabled:opacity-50 ${
          isEndorsed
            ? "border-yellow-500/50 bg-yellow-500/15 text-yellow-300 hover:bg-yellow-500/25"
            : otherEndorsed
              ? "border-card-border text-muted hover:text-foreground"
              : !partyColor
                ? "border-primary/40 bg-primary/10 text-primary hover:bg-primary/20"
                : "hover:brightness-125"
        }`}
      >
        {pending ? "…" : isEndorsed ? "Endorsed ✓" : otherEndorsed ? "Switch" : "Endorse"}
      </button>
      {error && <span className="text-[10px] text-error">{error}</span>}
    </div>
  );
}
