"use client";

import Link from "next/link";
import { Avatar } from "@/components/Avatar";
import { formatVotes } from "./ElectionDetailHelpers";
import type { CandidateDetail, GeneralVotes } from "./ElectionDetailTypes";

interface CandidateComparisonCardsProps {
  sorted: CandidateDetail[];
  colorMap: Map<string, string>;
  tally: GeneralVotes;
  grandTotal: number;
  electoralVotes: Record<string, number> | undefined;
  winner: CandidateDetail | null;
}

export function CandidateComparisonCards({
  sorted,
  colorMap,
  tally,
  grandTotal,
  electoralVotes,
  winner,
}: CandidateComparisonCardsProps) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {sorted.slice(0, 2).map((c, idx) => {
        const ev = electoralVotes?.[c.id] ?? 0;
        const votes = tally.totalVotes[c.id] ?? 0;
        const pct = (votes / grandTotal) * 100;
        const color = colorMap.get(c.id)!;
        const href = c.isNPP ? `/politicians/npp/${c.nppId}` : `/character/${c.characterId}`;
        const statesWon = Object.entries(tally.stateVoteData ?? {}).filter(([, data]) => {
          const stateVotes = Object.entries(data.votesByCandidate);
          const topCandidate = stateVotes.reduce(
            (max, [candId, v]) => (v > (data.votesByCandidate[max] ?? 0) ? candId : max),
            stateVotes[0]?.[0] ?? ""
          );
          return topCandidate === c.id;
        }).length;

        return (
          <div
            key={c.id}
            className={`rounded-xl border-2 p-6 ${
              idx === 0 && winner?.id === c.id
                ? "border-yellow-500/40 bg-gradient-to-br from-yellow-500/5 to-transparent"
                : "border-card-border bg-card"
            }`}
          >
            <div className="flex items-start gap-4 mb-4">
              <Avatar url={c.avatarUrl} name={c.characterName} size="h-16 w-16" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <Link
                    href={href}
                    className="text-xl font-bold hover:text-primary transition-colors"
                  >
                    {c.characterName}
                  </Link>
                  {idx === 0 && winner?.id === c.id && (
                    <span className="text-yellow-400 text-xl">★</span>
                  )}
                </div>
                <div className="text-sm font-medium mb-1" style={{ color }}>
                  {c.partyName}
                </div>
                {c.runningMateName && (
                  <div className="text-xs text-muted">Running Mate: {c.runningMateName}</div>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 mb-4">
              <div>
                <div className="text-xs text-muted mb-1">Electoral Votes</div>
                <div className="text-2xl font-bold tabular-nums" style={{ color }}>
                  {ev}
                </div>
              </div>
              <div>
                <div className="text-xs text-muted mb-1">Popular Vote</div>
                <div className="text-2xl font-bold tabular-nums" style={{ color }}>
                  {pct.toFixed(1)}%
                </div>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3 pt-4 border-t border-card-border">
              <div>
                <div className="text-xs text-muted mb-1">States Won</div>
                <div className="text-lg font-semibold">{statesWon}</div>
              </div>
              <div>
                <div className="text-xs text-muted mb-1">Total Votes</div>
                <div className="text-sm font-semibold">{formatVotes(votes)}</div>
              </div>
              <div>
                <div className="text-xs text-muted mb-1">Favorability</div>
                <div className="text-sm font-semibold text-yellow-400">
                  {c.favorability.toFixed(0)}%
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
