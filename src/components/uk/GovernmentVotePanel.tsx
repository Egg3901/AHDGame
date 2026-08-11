"use client";

import { useState } from "react";
import { VoteTallyTable } from "@/app/congress/bills/[id]/components/VoteTallyTable";
import { WhippedBadge } from "@/components/bills/WhippedBadge";
import { useGameClock } from "@/contexts/useGameClock";
import type { VoteByParty } from "@/lib/congress/governmentVoteBreakdown";

interface PMAppointmentVoteData {
  type: "pmAppointment";
  _id: string;
  nomineeName: string;
  nomineePartyId: string;
  formationType: "majority" | "coalition" | "minority" | "admin";
  votesFor: number;
  votesAgainst: number;
  voteByParty: VoteByParty[];
  status: string;
  closesAt: string;
  closesOnTurn?: number | null;
}

interface NoConfidenceVoteData {
  type: "noConfidence";
  _id: string;
  proposedByName: string;
  targetPmName: string;
  votesFor: number;
  votesAgainst: number;
  voteByParty: VoteByParty[];
  status: string;
  closesAt: string;
  closesOnTurn?: number | null;
}

type VoteData = PMAppointmentVoteData | NoConfidenceVoteData;

interface GovernmentVotePanelProps {
  vote: VoteData;
  countryCode: string;
  canVote: boolean;
  viewerVote: "aye" | "nay" | null;
  /** Pre-whip snapshot ("for" | "against" | "unvoted") when the viewer was Player-Whipped. */
  myWhippedFrom?: string | null;
  appointmentLabel?: string;
  onVoteCast?: () => void;
}

function getTimeRemaining(closesAt: string): string {
  const remaining = new Date(closesAt).getTime() - Date.now();
  // Vote is still "active" in the backend but the closing window has passed.
  // Inline resolution normally closes this gap instantly, but if the user's
  // view is cached or the resolver failed, surface that the motion is pending
  // rather than claiming it ended with no consequence.
  if (remaining <= 0) return "Voting ended — awaiting resolution";
  const hours = Math.floor(remaining / 3_600_000);
  const mins = Math.floor((remaining % 3_600_000) / 60_000);
  return `${hours}h ${mins}m remaining`;
}

export default function GovernmentVotePanel({
  vote,
  countryCode,
  canVote,
  viewerVote,
  myWhippedFrom,
  appointmentLabel = "PM Appointment Vote",
  onVoteCast,
}: GovernmentVotePanelProps) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const clock = useGameClock();

  const isActive = vote.status === "active";
  // Turn-based countdown freezes on pause (currentTurn frozen) and resumes
  // cleanly; fall back to the wall-clock string for docs not yet backfilled.
  const timeRemaining =
    vote.closesOnTurn != null
      ? clock.formatRemainingTurns(vote.closesOnTurn).text
      : getTimeRemaining(vote.closesAt);

  const handleVote = async (direction: "aye" | "nay") => {
    setSubmitting(true);
    setError(null);
    let errorMsg: string | null = null;
    try {
      const endpoint =
        vote.type === "pmAppointment"
          ? `/api/country/${countryCode}/pm/appoint/${vote._id}/vote`
          : `/api/country/${countryCode}/pm/no-confidence/${vote._id}/vote`;

      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vote: direction }),
      });
      const data = await res.json();
      if (!res.ok) {
        errorMsg = data.error ?? "Failed to cast vote.";
      } else {
        onVoteCast?.();
      }
    } catch {
      errorMsg = "Network error.";
    } finally {
      setSubmitting(false);
    }
    if (errorMsg) {
      setError(errorMsg);
      throw new Error(errorMsg);
    }
  };

  const headerLabel = vote.type === "pmAppointment" ? appointmentLabel : "No-Confidence Motion";

  const subjectLine =
    vote.type === "pmAppointment" ? (
      <p className="text-sm text-foreground">
        <span className="font-semibold">{vote.nomineeName}</span>
        {" — "}
        <span className="capitalize text-muted">{vote.formationType} government</span>
      </p>
    ) : (
      <p className="text-sm text-foreground">
        Target: <span className="font-semibold">{vote.targetPmName}</span>
        {" · Proposed by "}
        <span className="font-semibold">{vote.proposedByName}</span>
      </p>
    );

  return (
    <div className="rounded-2xl border border-card-border bg-card p-5 shadow-card">
      {/* Header */}
      <div className="mb-3 flex items-center justify-between gap-4">
        <h3 className="text-base font-semibold">{headerLabel}</h3>
        {isActive && <span className="text-xs text-muted">{timeRemaining}</span>}
      </div>

      {/* Subject line */}
      <div className="mb-4">{subjectLine}</div>

      {/* Tallies */}
      <div className="mb-4 flex gap-4 text-sm">
        <span className="font-bold text-success">{vote.votesFor} Aye</span>
        <span className="font-bold text-error">{vote.votesAgainst} Nay</span>
      </div>

      {vote.voteByParty.length > 0 && (
        <div className="mb-4 rounded-xl border border-card-border/60 bg-card-muted/20 p-3">
          <p className="mb-2 text-xs font-medium text-muted">Breakdown by party</p>
          <VoteTallyTable
            voteByParty={vote.voteByParty}
            chamberLabel={
              vote.type === "pmAppointment"
                ? appointmentLabel.toLowerCase()
                : "No-confidence motion"
            }
            forLabel="Aye"
            againstLabel="Nay"
          />
        </div>
      )}

      {/* Vote buttons — always shown when active so players can change their vote */}
      {isActive && canVote && (
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => handleVote("aye").catch(() => {})}
            disabled={submitting}
            className={`rounded-lg border px-4 py-1.5 text-sm font-semibold text-success disabled:opacity-50 ${
              viewerVote === "aye"
                ? "border-success bg-success/30"
                : "border-success/30 bg-success/10 hover:bg-success/20"
            }`}
          >
            {viewerVote === "aye" ? "✓ Aye" : "Vote Aye"}
          </button>
          <button
            type="button"
            onClick={() => handleVote("nay").catch(() => {})}
            disabled={submitting}
            className={`rounded-lg border px-4 py-1.5 text-sm font-semibold text-error disabled:opacity-50 ${
              viewerVote === "nay"
                ? "border-error bg-error/30"
                : "border-error/30 bg-error/10 hover:bg-error/20"
            }`}
          >
            {viewerVote === "nay" ? "✓ Nay" : "Vote Nay"}
          </button>
        </div>
      )}

      {/* Player-Whip badge — shown when viewer's vote was force-set by their party */}
      {myWhippedFrom && isActive && (
        <div className="mt-2">
          <WhippedBadge
            originalVote={myWhippedFrom}
            onRevert={async (v) => {
              if (v === "unvoted") return;
              // Snapshot is stored in bill-vote semantics; translate back to aye/nay.
              const direction: "aye" | "nay" = v === "for" ? "aye" : "nay";
              await handleVote(direction);
            }}
          />
        </div>
      )}

      {/* Result when vote is closed */}
      {!isActive && (
        <div className="space-y-1">
          <p className="text-sm text-muted capitalize">
            Result: <span className="font-semibold text-foreground">{vote.status}</span>
          </p>
          {vote.type === "noConfidence" && vote.status === "failed" && (
            <p className="text-xs text-muted">
              A 48-turn cooldown is now in effect before another motion can be proposed.
            </p>
          )}
        </div>
      )}

      {error && <p className="mt-2 text-sm text-error">{error}</p>}
    </div>
  );
}
