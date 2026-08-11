"use client";

import { useEffect } from "react";
import Link from "next/link";
import { LineGraph } from "./ElectionDetailCharts";
import type { VoteTurnSnapshot } from "./ElectionDetailTypes";
import { electionRegionUrl } from "@/lib/urls";

interface StateDetailModalProps {
  electionId: string;
  stateId: string;
  countryId: string;
  stateName: string;
  votesByCandidate: Record<string, number>;
  evByCandidate: Record<string, number>;
  candidateNames: Record<string, string>;
  /** candidateId → party hex colour, resolved server-side. */
  candidateColors?: Record<string, string>;
  snapshots: VoteTurnSnapshot[];
  onClose: () => void;
}

export function StateDetailModal({
  electionId,
  stateId,
  countryId,
  stateName,
  votesByCandidate,
  evByCandidate,
  candidateNames,
  candidateColors = {},
  snapshots,
  onClose,
}: StateDetailModalProps) {
  const colorFor = (cid: string): string => candidateColors[cid] ?? "#9CA3AF";
  const totalVotes = Object.values(votesByCandidate).reduce((s, v) => s + v, 0);
  const totalEv = Object.values(evByCandidate).reduce((s, v) => s + v, 0);
  const sorted = Object.entries(votesByCandidate)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1]);
  const winnerId = sorted[0]?.[0];
  const winnerName = winnerId ? (candidateNames[winnerId] ?? "Unknown") : null;

  /** Per-turn share change (from last 2+ snapshots): candidateId -> pct per turn */
  const trendPerTurn: Record<string, number> = {};
  /** Split of votes gained this turn: candidateId -> pct of new votes (e.g. 75% trending Dem) */
  const trendSplitThisTurn: Record<string, number> = {};
  if (snapshots.length >= 2) {
    const last = snapshots[snapshots.length - 1];
    const prev = snapshots[snapshots.length - 2];
    const turnDelta = last.turn - prev.turn;
    if (turnDelta > 0) {
      for (const cid of Object.keys(last.sharesPct ?? {})) {
        const nowPct = last.sharesPct[cid] ?? 0;
        const prevPct = prev.sharesPct[cid] ?? 0;
        trendPerTurn[cid] = (nowPct - prevPct) / turnDelta;
      }
    }
    // Votes gained this turn: what % of new votes went to each candidate
    const voteDeltas: Record<string, number> = {};
    let totalDelta = 0;
    for (const cid of Object.keys(last.cumulativeVotes ?? {})) {
      const prevV = prev.cumulativeVotes?.[cid] ?? 0;
      const nowV = last.cumulativeVotes?.[cid] ?? 0;
      const d = Math.max(0, nowV - prevV);
      voteDeltas[cid] = d;
      totalDelta += d;
    }
    if (totalDelta > 0) {
      for (const [cid, d] of Object.entries(voteDeltas)) {
        trendSplitThisTurn[cid] = (d / totalDelta) * 100;
      }
    }
  }

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const candidatesForChart = sorted.map(([id]) => ({
    id,
    name: candidateNames[id] ?? "Unknown",
    color: colorFor(id),
  }));
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-card-border bg-card shadow-modal"
        role="dialog"
        aria-modal="true"
        aria-label="State election details"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 border-b border-card-border bg-card px-5 py-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-lg font-semibold">{stateName}</h3>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-2 text-muted hover:bg-background hover:text-foreground"
              aria-label="Close"
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>
          <Link
            href={electionRegionUrl(electionId, countryId, stateId)}
            className="text-sm text-primary hover:underline inline-flex items-center gap-1"
            onClick={onClose}
          >
            View county map →
          </Link>
        </div>

        <div className="space-y-5 p-5">
          <div>
            <div className="mb-2 text-xs font-medium uppercase tracking-wider text-muted">
              Projected EV winner
            </div>
            <div className="rounded-xl border border-card-border bg-background p-3">
              {winnerName && (
                <div className="flex items-center gap-2">
                  <span
                    className="inline-block h-3 w-3 rounded-sm shrink-0"
                    style={{
                      backgroundColor: colorFor(winnerId!),
                    }}
                  />
                  <span className="font-semibold">{winnerName}</span>
                  <span className="text-muted">({totalEv} EV)</span>
                </div>
              )}
            </div>
          </div>

          <div>
            <div className="mb-2 text-xs font-medium uppercase tracking-wider text-muted">
              Vote split
            </div>
            <div className="space-y-2">
              {sorted.map(([cid, votes]) => {
                const pct = totalVotes > 0 ? (votes / totalVotes) * 100 : 0;
                const ev = evByCandidate[cid] ?? 0;
                const trend = trendPerTurn[cid];
                const color = colorFor(cid);
                return (
                  <div
                    key={cid}
                    className="flex items-center justify-between rounded-lg border border-card-border bg-background px-3 py-2"
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className="inline-block h-2.5 w-2.5 rounded-sm shrink-0"
                        style={{ backgroundColor: color }}
                      />
                      <span className="font-medium">{candidateNames[cid] ?? "Unknown"}</span>
                    </div>
                    <div className="flex flex-col items-end gap-0.5 text-sm">
                      <div className="flex items-center gap-3">
                        <span className="tabular-nums text-muted">
                          {votes.toLocaleString("en-US")} ({pct.toFixed(1)}%)
                        </span>
                        {ev > 0 && <span className="font-medium tabular-nums">{ev} EV</span>}
                      </div>
                      {trend !== undefined && Math.abs(trend) >= 0.01 && (
                        <span
                          className={`text-xs tabular-nums ${
                            trend > 0 ? "text-green-500" : "text-red-500"
                          }`}
                          title="Vote share change per turn"
                        >
                          {trend > 0 ? "+" : ""}
                          {trend.toFixed(2)}%/turn
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            {Object.keys(trendSplitThisTurn).length > 0 && (
              <div className="mt-2 rounded-lg border border-dashed border-card-border bg-muted/30 px-3 py-2 text-sm">
                <span className="text-muted">Trending this turn: </span>
                {Object.entries(trendSplitThisTurn)
                  .filter(([, pct]) => pct >= 0.5)
                  .sort((a, b) => b[1] - a[1])
                  .map(([cid, pct], i) => (
                    <span key={cid}>
                      {i > 0 && <span className="text-muted"> · </span>}
                      <span
                        style={{
                          color: colorFor(cid),
                        }}
                      >
                        {candidateNames[cid] ?? "Unknown"}: {pct.toFixed(1)}%
                      </span>
                    </span>
                  ))}
                <span className="text-muted text-xs block mt-1">(of votes gained this turn)</span>
              </div>
            )}
          </div>

          {snapshots.length >= 2 && (
            <div>
              <div className="mb-2 text-xs font-medium uppercase tracking-wider text-muted">
                Vote share over time
              </div>
              <div className="rounded-xl border border-card-border bg-background p-3">
                <LineGraph
                  snapshots={snapshots}
                  series={candidatesForChart}
                  yValues={(id, snap) => snap.sharesPct[id] ?? null}
                  yMax={100}
                  yLabel={(v) => `${v}%`}
                  xLabel={(s) => `T${s.turn}`}
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
