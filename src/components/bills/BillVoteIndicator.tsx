"use client";

import { useEffect, useState } from "react";

interface BillVoteIndicatorProps {
  billId: string;
  myVote: "for" | "against" | "abstain" | null;
  canVote: boolean;
  onVoted?: (billId: string, vote: "for" | "against" | "abstain") => void;
  omitAbstain?: boolean;
  /** Subnational legislature: POST `{ vote }` only (no `action` field). */
  stateVoteUrl?: string;
  /** When `rawStateBillStatus` is `veto_override`, POST here instead of `stateVoteUrl`. */
  stateOverrideVoteUrl?: string;
  /** Raw state bill status from API — selects override vs chamber vote URL */
  rawStateBillStatus?: string;
}

export function BillVoteIndicator({
  billId,
  myVote,
  canVote,
  onVoted,
  omitAbstain = false,
  stateVoteUrl,
  stateOverrideVoteUrl,
  rawStateBillStatus,
}: BillVoteIndicatorProps) {
  const [voting, setVoting] = useState(false);
  const [currentVote, setCurrentVote] = useState(myVote);

  useEffect(() => {
    setCurrentVote(myVote);
  }, [myVote]);

  const castVote = async (vote: "for" | "against" | "abstain") => {
    setVoting(true);
    try {
      const isState = Boolean(stateVoteUrl);
      const url =
        isState && rawStateBillStatus === "veto_override" && stateOverrideVoteUrl
          ? stateOverrideVoteUrl
          : isState && stateVoteUrl
            ? stateVoteUrl
            : `/api/congress/bills/${billId}`;
      const body = isState ? JSON.stringify({ vote }) : JSON.stringify({ action: "vote", vote });
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      });
      if (res.ok) {
        setCurrentVote(vote);
        onVoted?.(billId, vote);
      }
    } finally {
      setVoting(false);
    }
  };

  const indicator =
    currentVote === "for" ? (
      <span className="text-success text-xs font-medium">&#10003; Voted For</span>
    ) : currentVote === "against" ? (
      <span className="text-error text-xs font-medium">&#10007; Voted Against</span>
    ) : currentVote === "abstain" ? (
      <span className="text-muted text-xs font-medium">&mdash; Abstained</span>
    ) : canVote ? (
      <span className="text-muted/60 text-xs italic">Not yet voted</span>
    ) : null;

  if (!indicator) return null;

  return (
    <div className="flex items-center justify-between gap-2">
      {indicator}
      {canVote && (
        <div className="flex gap-1 shrink-0">
          {(omitAbstain
            ? (["for", "against"] as const)
            : (["for", "against", "abstain"] as const)
          ).map((voteOption) => (
            <button
              key={voteOption}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                castVote(voteOption);
              }}
              disabled={voting}
              className={`rounded-md border px-2 py-0.5 text-[10px] font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                currentVote === voteOption
                  ? voteOption === "for"
                    ? "border-emerald-500/50 bg-emerald-500/20 text-emerald-400"
                    : voteOption === "against"
                      ? "border-red-500/50 bg-red-500/20 text-red-400"
                      : "border-card-border bg-muted/20 text-muted"
                  : voteOption === "for"
                    ? "border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10"
                    : voteOption === "against"
                      ? "border-red-500/30 text-red-400 hover:bg-red-500/10"
                      : "border-card-border text-muted hover:bg-muted/10"
              }`}
            >
              {voteOption === "for" ? "Aye" : voteOption === "against" ? "Nay" : "Abstain"}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
