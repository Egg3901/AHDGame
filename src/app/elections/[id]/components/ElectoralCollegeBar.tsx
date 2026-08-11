"use client";

import type { CandidateDetail } from "./ElectionDetailTypes";

interface ElectoralCollegeBarProps {
  sorted: CandidateDetail[];
  colorMap: Map<string, string>;
  electoralVotes: Record<string, number>;
  isEnded: boolean;
  evNeeded?: number;
  totalEV?: number;
  /** Seated president (may differ from EV leader after contingent resolution). */
  winnerCandidateId?: string | null;
}

export function ElectoralCollegeBar({
  sorted,
  colorMap,
  electoralVotes,
  isEnded,
  evNeeded = 270,
  totalEV = 538,
  winnerCandidateId = null,
}: ElectoralCollegeBarProps) {
  return (
    <div className="rounded-xl border border-card-border bg-card p-5">
      <div className="flex items-baseline justify-between mb-3">
        <h3 className="text-lg font-semibold">Electoral College</h3>
        <span className="text-sm text-muted">
          {totalEV} votes · {evNeeded} to win
        </span>
      </div>

      <div className="space-y-3">
        {/* Unified distribution bar */}
        <div className="relative h-12 rounded-lg overflow-hidden border border-card-border bg-background flex">
          {sorted.map((c) => {
            const ev = electoralVotes[c.id] ?? 0;
            const pct = (ev / totalEV) * 100;
            const color = colorMap.get(c.id)!;
            if (pct === 0) return null;
            return (
              <div
                key={c.id}
                className="h-full flex items-center justify-center relative group"
                style={{ width: `${pct}%`, backgroundColor: color }}
              >
                {pct > 8 && <span className="text-white font-bold text-sm tabular-nums">{ev}</span>}
                <div className="absolute inset-0 bg-white/0 group-hover:bg-white/10 transition-colors" />
              </div>
            );
          })}

          {/* 270 marker */}
          <div
            className="absolute top-0 bottom-0 w-0.5 bg-foreground/40 pointer-events-none"
            style={{ left: `${(evNeeded / totalEV) * 100}%` }}
          >
            <div className="absolute -top-1 left-1/2 -translate-x-1/2 text-[10px] font-bold text-foreground/60 whitespace-nowrap">
              270
            </div>
          </div>
        </div>

        {/* Legend */}
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          {sorted.map((c) => {
            const ev = electoralVotes[c.id] ?? 0;
            const color = colorMap.get(c.id)!;
            const isWinner =
              isEnded &&
              (winnerCandidateId != null
                ? c.id === winnerCandidateId
                : c === sorted[0] && ev >= evNeeded);

            return (
              <div key={c.id} className="flex items-center gap-2">
                <div className="h-3 w-3 rounded-sm shrink-0" style={{ backgroundColor: color }} />
                <span className="font-semibold">{c.characterName}</span>
                <span className="font-bold tabular-nums" style={{ color }}>
                  {ev}
                </span>
                {isWinner && <span className="text-yellow-400 text-sm">★</span>}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
