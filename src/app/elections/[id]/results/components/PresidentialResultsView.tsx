"use client";

import { useMemo } from "react";
import dynamic from "next/dynamic";
import type { ElectionResultsResponse } from "@/lib/elections/liveResults/types";
import { MajorityBar } from "./MajorityBar";
import { CandidateTotalsPanel } from "./CandidateTotalsPanel";
import { RaceResultCard } from "./RaceResultCard";
import { ResultsTable } from "./ResultsTable";
import { ResultsBlendView } from "../../blend/ResultsBlendView";

// Browser-only (react-simple-maps) — lazy-load with a matching skeleton.
const ElectoralResultsMap = dynamic(
  () => import("./ElectoralResultsMap").then((m) => ({ default: m.ElectoralResultsMap })),
  {
    ssr: false,
    loading: () => (
      <div className="h-[420px] w-full animate-pulse rounded-xl border border-card-border bg-card" />
    ),
  }
);

/**
 * Electoral-college layout: EV bar with the majority marker (solid = called,
 * translucent = leading), candidate totals, the electoral map (US — other
 * countries fall back to the per-region card grid), full table.
 */
export function PresidentialResultsView({ data }: { data: ElectionResultsResponse }) {
  const { election, candidates, units, summary } = data;

  // Proposal D's results screen serves this dashboard and the concluded page
  // alike. It needs a real electoral college to lay out, so a race without one
  // falls through to the existing view.
  const hasCollege = (election.totalEv ?? 0) > 0 && units.length > 0;
  const candidatesById = useMemo(() => new Map(candidates.map((c) => [c.id, c])), [candidates]);
  // The map is US-shaped. Simulated frames keep real state ids unless the
  // board was fabricated from nothing (sim-unit-*), which the map can't plot.
  const useMap =
    election.countryId === "US" &&
    units.length > 0 &&
    !units.some((u) => u.id.startsWith("sim-unit"));

  const segments = useMemo(
    () =>
      candidates
        .filter((c) => (c.electoralVotes ?? 0) > 0 || (c.leadingElectoralVotes ?? 0) > 0)
        .map((c) => ({
          id: c.id,
          label: c.name,
          color: c.partyColor,
          value: c.electoralVotes ?? 0,
          softValue: c.leadingElectoralVotes ?? 0,
        })),
    [candidates]
  );

  // Sort the board: called first (most recent drama), then closest margins.
  const boardUnits = useMemo(() => {
    return [...units].sort((a, b) => {
      if (a.called !== b.called) return a.called ? -1 : 1;
      if ((a.totalVotes === 0) !== (b.totalVotes === 0)) return a.totalVotes === 0 ? 1 : -1;
      return a.leaderMarginPct - b.leaderMarginPct;
    });
  }, [units]);

  if (hasCollege) {
    return <ResultsBlendView data={data} route="dashboard" />;
  }

  return (
    <div className="space-y-4">
      {election.totalEv ? (
        <div className="rounded-xl border border-card-border bg-card p-5">
          <div className="mb-3 flex items-baseline justify-between gap-2">
            <h3 className="text-sm font-semibold">Electoral College</h3>
            <span className="text-xs text-muted tabular-nums">
              {election.evNeeded} to win · solid = called, faded = leading
            </span>
          </div>
          <MajorityBar
            segments={segments}
            total={election.totalEv}
            threshold={election.evNeeded ?? Math.floor(election.totalEv / 2) + 1}
            thresholdLabel={`${election.evNeeded ?? Math.floor(election.totalEv / 2) + 1}`}
          />
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
            {segments.map((s) => (
              <span key={s.id} className="inline-flex items-center gap-1.5 text-xs tabular-nums">
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: s.color }} />
                <span className="font-medium">{s.label}</span>
                <span className="text-muted">
                  {s.value}
                  {s.softValue ? ` (+${s.softValue} leading)` : ""}
                </span>
              </span>
            ))}
          </div>
        </div>
      ) : null}

      <CandidateTotalsPanel
        candidates={candidates}
        mode="ev"
        projectedWinner={summary.projectedWinner}
      />

      {units.length > 0 &&
        (useMap ? (
          <ElectoralResultsMap units={units} candidatesById={candidatesById} />
        ) : (
          <div>
            <h3 className="mb-2 text-sm font-semibold">Region by region</h3>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
              {boardUnits.map((unit, i) => (
                <RaceResultCard
                  key={`${unit.id}:${unit.called}`}
                  unit={unit}
                  candidatesById={candidatesById}
                  index={i}
                  weightLabel="EV"
                />
              ))}
            </div>
          </div>
        ))}

      <ResultsTable
        units={units}
        candidatesById={candidatesById}
        unitLabel="State"
        title="All states"
      />
    </div>
  );
}
