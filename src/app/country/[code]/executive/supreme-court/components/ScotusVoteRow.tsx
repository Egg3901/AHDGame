"use client";

import { useState, useEffect } from "react";

export interface ScotusNominationRow {
  id: string;
  seatNumber: number;
  nomineeMode: "character" | "npp";
  nomineeName: string;
  nomineeParty: string | null;
  status: string;
  votesFor: number;
  votesAgainst: number;
  votesAbstain: number;
  votingEndsAt: string | null;
  myVote: "for" | "against" | "abstain" | null;
}

/**
 * Senate-side SCOTUS confirmation vote row (#3605). Mirrors `CabinetVoteRow`
 * (src/app/whitehouse/cabinet/components) field-for-field, swapping the fixed
 * cabinet position name for the numbered Court seat and the player-only
 * nominee name for `nomineeName` (works for both a player character and a
 * generated NPP legal scholar).
 */
export function ScotusVoteRow({
  nomination,
  isSenator,
  onVote,
  votingId,
}: {
  nomination: ScotusNominationRow;
  isSenator: boolean;
  onVote: (id: string, vote: "for" | "against" | "abstain") => void;
  votingId: string | null;
}) {
  const [countdown, setCountdown] = useState("");
  useEffect(() => {
    if (!nomination.votingEndsAt) return;
    function tick() {
      const ms = new Date(nomination.votingEndsAt!).getTime() - Date.now();
      if (ms <= 0) {
        setCountdown("Ended");
        return;
      }
      const h = Math.floor(ms / 3_600_000);
      const m = Math.floor((ms % 3_600_000) / 60_000);
      setCountdown(`${h}h ${m}m`);
    }
    tick();
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, [nomination.votingEndsAt]);

  if (!isSenator) return null;

  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-4 rounded-xl border border-card-border bg-card p-4 shadow-sm">
      <div className="flex-1 min-w-0">
        <p className="font-medium text-foreground">
          {nomination.nomineeName} → Seat #{nomination.seatNumber}
          {nomination.nomineeMode === "npp" && (
            <span className="ml-2 rounded-full border border-card-border bg-card-elevated px-2 py-0.5 text-[10px] font-medium text-muted align-middle">
              NPP
            </span>
          )}
        </p>
        <p className="text-sm text-muted">
          {nomination.votesFor} for · {nomination.votesAgainst} against · {nomination.votesAbstain}{" "}
          abstain
          {nomination.votingEndsAt && ` · ${countdown}`}
        </p>
        {nomination.myVote && (
          <p className="text-xs text-muted mt-1">Your vote: {nomination.myVote}</p>
        )}
      </div>
      <div className="flex flex-wrap gap-2 shrink-0">
        <button
          onClick={() => onVote(nomination.id, "for")}
          disabled={votingId !== null}
          className={`min-h-[44px] min-w-[64px] touch-manipulation rounded-lg px-3 py-2 text-xs font-medium transition-colors ${
            nomination.myVote === "for"
              ? "bg-success/20 text-success border border-success/50"
              : "border border-card-border bg-card hover:bg-card-elevated text-foreground"
          }`}
        >
          For
        </button>
        <button
          onClick={() => onVote(nomination.id, "against")}
          disabled={votingId !== null}
          className={`min-h-[44px] min-w-[64px] touch-manipulation rounded-lg px-3 py-2 text-xs font-medium transition-colors ${
            nomination.myVote === "against"
              ? "bg-error/20 text-error border border-error/50"
              : "border border-card-border bg-card hover:bg-card-elevated text-foreground"
          }`}
        >
          Against
        </button>
        <button
          onClick={() => onVote(nomination.id, "abstain")}
          disabled={votingId !== null}
          className={`min-h-[44px] min-w-[64px] touch-manipulation rounded-lg px-3 py-2 text-xs font-medium transition-colors ${
            nomination.myVote === "abstain"
              ? "bg-muted/20 text-muted border border-muted/50"
              : "border border-card-border bg-card hover:bg-card-elevated text-foreground"
          }`}
        >
          Abstain
        </button>
      </div>
    </div>
  );
}
