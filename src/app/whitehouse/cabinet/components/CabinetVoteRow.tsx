"use client";

import { useState, useEffect } from "react";

export interface PositionNomination {
  id: string;
  nomineeCharacterId: string;
  nomineeCharacterName: string;
  nomineeParty?: string;
  status: string;
  votesFor: number;
  votesAgainst: number;
  votesAbstain: number;
  votingEndsAt: string | null;
  myVote: "for" | "against" | "abstain" | null;
}

export function CabinetVoteRow({
  positionName,
  nomination,
  isSenator,
  onVote,
  votingId,
}: {
  positionName: string;
  nomination: PositionNomination;
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

  // A table row: rendered inside the administration table's Senate-votes block.
  return (
    <tr className="border-t border-card-border/50 first:border-t-0">
      <td className="px-4 py-2.5">
        <p className="font-medium text-foreground">{nomination.nomineeCharacterName}</p>
        <p className="text-[11px] text-muted">{positionName}</p>
      </td>
      <td className="px-3 py-2.5 text-xs text-muted tabular-nums">
        {nomination.votesFor} for · {nomination.votesAgainst} against · {nomination.votesAbstain}{" "}
        abstain
        {nomination.votingEndsAt && <span className="ml-1.5 font-mono">{countdown}</span>}
        {nomination.myVote && <span className="mt-0.5 block">Your vote: {nomination.myVote}</span>}
      </td>
      <td className="px-4 py-2.5">
        <div className="flex justify-end gap-1.5">
          {(["for", "against", "abstain"] as const).map((v) => (
            <button
              key={v}
              onClick={() => onVote(nomination.id, v)}
              disabled={votingId !== null}
              className={`min-h-[36px] min-w-[64px] touch-manipulation rounded-md border px-3 py-1 text-xs font-medium transition-colors disabled:opacity-50 ${
                nomination.myVote === v
                  ? v === "for"
                    ? "border-success/50 bg-success/20 text-success"
                    : v === "against"
                      ? "border-error/50 bg-error/20 text-error"
                      : "border-muted/50 bg-muted/20 text-muted"
                  : "border-card-border bg-card text-foreground hover:bg-card-elevated"
              }`}
            >
              {v === "for" ? "For" : v === "against" ? "Against" : "Abstain"}
            </button>
          ))}
        </div>
      </td>
    </tr>
  );
}
