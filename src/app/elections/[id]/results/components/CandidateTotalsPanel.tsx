"use client";

import type { ResultsCandidate } from "@/lib/elections/liveResults/types";
import { formatVotes } from "./resultsFormat";

interface CandidateTotalsPanelProps {
  candidates: ResultsCandidate[];
  /** "ev" shows called+leading EV chips, "seats" shows seat projections. */
  mode: "ev" | "seats" | "votes";
  projectedWinner?: string | null;
}

/** Ranked candidate list with animated vote-share bars. */
export function CandidateTotalsPanel({
  candidates,
  mode,
  projectedWinner,
}: CandidateTotalsPanelProps) {
  if (candidates.length === 0) {
    return (
      <div className="rounded-xl border border-card-border bg-card p-5 text-center text-sm text-muted">
        No candidates registered.
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-card-border bg-card p-5">
      <h3 className="mb-3 text-sm font-semibold">Candidates</h3>
      <div className="space-y-3">
        {candidates.map((c) => (
          <div key={c.id}>
            <div className="mb-1 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
              <span className="inline-flex items-center gap-2 text-sm font-medium">
                <span
                  className="h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: c.partyColor }}
                />
                {c.name}
                {c.isNPP && (
                  <span className="text-[10px] uppercase tracking-wide text-muted">NPP</span>
                )}
                {projectedWinner === c.id && (
                  <span className="rounded-full bg-success/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-success">
                    ✓ Projected winner
                  </span>
                )}
              </span>
              <span className="text-xs text-muted tabular-nums">
                {mode === "ev" && (
                  <>
                    <span className="font-semibold text-foreground">
                      {c.electoralVotes ?? 0} EV
                    </span>
                    {(c.leadingElectoralVotes ?? 0) > 0 && (
                      <span> · leading {c.leadingElectoralVotes}</span>
                    )}
                    {" · "}
                  </>
                )}
                {mode === "seats" && (
                  <>
                    <span className="font-semibold text-foreground">
                      {c.seatsProjected ?? 0} seats
                    </span>
                    {" · "}
                  </>
                )}
                {formatVotes(c.totalVotes)} votes · {c.voteSharePct.toFixed(1)}%
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-card-border">
              <div
                className="h-full rounded-full transition-[width] duration-1000 ease-out"
                style={{ width: `${c.voteSharePct}%`, backgroundColor: c.partyColor }}
              />
            </div>
            <div className="mt-0.5 text-[11px] text-muted">{c.partyName}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
