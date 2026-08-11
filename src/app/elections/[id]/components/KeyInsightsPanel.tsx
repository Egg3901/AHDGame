"use client";

import { useMemo } from "react";
import { STATE_NAMES, STATE_REGIONS, type StateResult } from "./generalElectionHelpers";
import type { CandidateDetail, GeneralVotes } from "./ElectionDetailTypes";
import { formatVotes } from "./ElectionDetailHelpers";

// Key Insights Panel Component
export function KeyInsightsPanel({
  tally,
  candidates,
  colorMap,
  electoralVotes: _electoralVotes,
}: {
  tally: GeneralVotes;
  candidates: CandidateDetail[];
  colorMap: Map<string, string>;
  electoralVotes?: Record<string, number>;
}) {
  const stateResults = useMemo(() => {
    if (!tally.stateVoteData) return [];

    const results: StateResult[] = [];
    for (const [stateId, data] of Object.entries(tally.stateVoteData)) {
      const stateVotes = Object.entries(data.votesByCandidate);
      if (stateVotes.length === 0) continue;

      const sorted = stateVotes.sort((a, b) => b[1] - a[1]);
      const winnerId = sorted[0][0];
      const winner = candidates.find((c) => c.id === winnerId);
      if (!winner) continue;

      const totalVotes = stateVotes.reduce((sum, [, votes]) => sum + votes, 0);
      const winnerVotes = sorted[0][1];
      const secondVotes = sorted[1]?.[1] ?? 0;
      const winnerPct = totalVotes > 0 ? (winnerVotes / totalVotes) * 100 : 0;
      const margin = totalVotes > 0 ? ((winnerVotes - secondVotes) / totalVotes) * 100 : 0;

      results.push({
        stateId,
        stateName: STATE_NAMES[stateId] || stateId,
        ev: tally.evByState?.[stateId] ?? 0,
        winnerId,
        winnerName: winner.characterName,
        winnerColor: colorMap.get(winnerId)!,
        margin,
        winnerPct,
        totalVotes,
      });
    }

    return results;
  }, [tally.stateVoteData, tally.evByState, candidates, colorMap]);

  const closestStates = useMemo(
    () => [...stateResults].sort((a, b) => a.margin - b.margin).slice(0, 5),
    [stateResults]
  );

  const biggestWins = useMemo(
    () => [...stateResults].sort((a, b) => b.margin - a.margin).slice(0, 5),
    [stateResults]
  );

  const regionalBreakdown = useMemo(() => {
    const regions: Record<
      string,
      {
        name: string;
        statesByCandidate: Record<string, number>;
        evByCandidate: Record<string, number>;
      }
    > = {
      Northeast: { name: "Northeast", statesByCandidate: {}, evByCandidate: {} },
      South: { name: "South", statesByCandidate: {}, evByCandidate: {} },
      Midwest: { name: "Midwest", statesByCandidate: {}, evByCandidate: {} },
      West: { name: "West", statesByCandidate: {}, evByCandidate: {} },
    };

    for (const result of stateResults) {
      const region = STATE_REGIONS[result.stateId];
      if (region && regions[region]) {
        regions[region].statesByCandidate[result.winnerId] =
          (regions[region].statesByCandidate[result.winnerId] || 0) + 1;
        regions[region].evByCandidate[result.winnerId] =
          (regions[region].evByCandidate[result.winnerId] || 0) + result.ev;
      }
    }

    return Object.values(regions);
  }, [stateResults]);

  const totalVotes = Object.values(tally.totalVotes).reduce((sum, v) => sum + v, 0);
  const popularVoteMargin =
    candidates.length >= 2
      ? Math.abs(
          (tally.totalVotes[candidates[0].id] ?? 0) - (tally.totalVotes[candidates[1].id] ?? 0)
        )
      : 0;
  const popularVoteMarginPct = totalVotes > 0 ? (popularVoteMargin / totalVotes) * 100 : 0;

  return (
    <div className="rounded-xl border border-card-border bg-card p-5">
      <h3 className="text-lg font-semibold mb-4">Key Insights</h3>

      <div className="grid gap-6 sm:grid-cols-2">
        {/* Closest States */}
        <div>
          <div className="text-sm font-medium text-muted mb-2">Closest States</div>
          <div className="space-y-2">
            {closestStates.map((state) => (
              <div key={state.stateId} className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  <div
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: state.winnerColor }}
                  />
                  <span className="font-medium">{state.stateName}</span>
                  <span className="text-xs text-muted">({state.ev} EV)</span>
                </div>
                <span className="font-semibold tabular-nums text-yellow-400">
                  +{state.margin.toFixed(1)}%
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Biggest Wins */}
        <div>
          <div className="text-sm font-medium text-muted mb-2">Biggest Landslides</div>
          <div className="space-y-2">
            {biggestWins.map((state) => (
              <div key={state.stateId} className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  <div
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: state.winnerColor }}
                  />
                  <span className="font-medium">{state.stateName}</span>
                  <span className="text-xs text-muted">({state.ev} EV)</span>
                </div>
                <span className="font-semibold tabular-nums" style={{ color: state.winnerColor }}>
                  +{state.margin.toFixed(1)}%
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Popular Vote Margin */}
      <div className="mt-4 pt-4 border-t border-card-border">
        <div className="text-sm font-medium text-muted mb-1">Popular Vote Margin</div>
        <div className="text-2xl font-bold tabular-nums">
          {formatVotes(popularVoteMargin)} votes ({popularVoteMarginPct.toFixed(2)}%)
        </div>
      </div>

      {/* Regional Breakdown */}
      <div className="mt-4 pt-4 border-t border-card-border">
        <div className="text-sm font-medium text-muted mb-3">Regional Performance</div>
        <div className="grid gap-3 sm:grid-cols-2">
          {regionalBreakdown.map((region) => {
            const entries = Object.entries(region.statesByCandidate).sort((a, b) => b[1] - a[1]);
            return (
              <div key={region.name} className="text-sm">
                <div className="font-semibold mb-1">{region.name}</div>
                {entries.map(([candId, states]) => {
                  const candidate = candidates.find((c) => c.id === candId);
                  const ev = region.evByCandidate[candId] || 0;
                  return candidate ? (
                    <div key={candId} className="flex items-center justify-between text-xs">
                      <span style={{ color: colorMap.get(candId)! }}>
                        {candidate.characterName}
                      </span>
                      <span className="text-muted">
                        {states} states · {ev} EV
                      </span>
                    </div>
                  ) : null;
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
