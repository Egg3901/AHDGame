"use client";

import { useMemo } from "react";
import type { ElectionResultsResponse } from "@/lib/elections/liveResults/types";
import { MajorityBar } from "./MajorityBar";
import { CandidateTotalsPanel } from "./CandidateTotalsPanel";
import { ResultsTable } from "./ResultsTable";
import { SeatProjectionBanner } from "./SeatProjectionBanner";

/**
 * Multi-seat layout (Commons, Shūgiin, Bundestag, US House regions, …).
 * When sibling regions exist, the national board takes the stage: Westminster
 * seat bar with the majority line, the projection call, and regions declaring
 * one by one through the final hour.
 */
export function ParliamentaryResultsView({ data }: { data: ElectionResultsResponse }) {
  const { election, candidates, units, national } = data;
  const candidatesById = useMemo(() => new Map(candidates.map((c) => [c.id, c])), [candidates]);
  const isLive = election.status === "active";

  const nationalSegments = useMemo(
    () =>
      (national?.parties ?? [])
        .filter((p) => p.projectedSeats > 0)
        .map((p) => ({
          id: p.party,
          label: p.abbreviation,
          color: p.color,
          value: p.declaredSeats,
          softValue: Math.max(0, p.projectedSeats - p.declaredSeats),
        })),
    [national]
  );

  return (
    <div className="space-y-4">
      {national && <SeatProjectionBanner national={national} isLive={isLive} />}

      {national && nationalSegments.length > 0 && (
        <div className="rounded-xl border border-card-border bg-card p-5">
          <div className="mb-3 flex items-baseline justify-between gap-2">
            <h3 className="text-sm font-semibold">{national.chamberLabel} — national picture</h3>
            <span className="text-xs text-muted tabular-nums">
              {national.majorityThreshold} for a majority · solid = declared, faded = projected
            </span>
          </div>
          <MajorityBar
            segments={nationalSegments}
            total={national.totalSeats}
            threshold={national.majorityThreshold}
            thresholdLabel={`${national.majorityThreshold}`}
          />
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
            {national.parties
              .filter((p) => p.projectedSeats > 0)
              .map((p) => (
                <span
                  key={p.party}
                  className="inline-flex items-center gap-1.5 text-xs tabular-nums"
                >
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: p.color }} />
                  <span className="font-medium">{p.name}</span>
                  <span className="text-muted">
                    {isLive ? `${p.declaredSeats} / ${p.projectedSeats} proj.` : p.projectedSeats}
                  </span>
                </span>
              ))}
          </div>
        </div>
      )}

      {national && isLive && (
        <div className="rounded-xl border border-card-border bg-card p-5">
          <div className="mb-3 flex items-baseline justify-between gap-2">
            <h3 className="text-sm font-semibold">Regions declaring</h3>
            <span className="text-xs text-muted tabular-nums">
              {national.regionsDeclared} of {national.totalRegions} declared
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {national.regions.map((r) => {
              const topParty = Object.entries(r.seatsByParty).sort((a, b) => b[1] - a[1])[0];
              const color = national.parties.find((p) => p.party === topParty?.[0])?.color;
              return (
                <span
                  key={r.electionId}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-all duration-500 ${
                    r.declared
                      ? "border-card-border bg-card-border/40 font-medium"
                      : "border-card-border/50 text-muted opacity-60"
                  }`}
                  title={
                    r.declared && topParty
                      ? `${r.name}: ${topParty[1]} of ${r.seats} seats lead`
                      : r.name
                  }
                >
                  {r.declared && (
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{ backgroundColor: color ?? "var(--muted)" }}
                    />
                  )}
                  {r.name}
                  <span className="text-[10px] text-muted tabular-nums">{r.seats}</span>
                </span>
              );
            })}
          </div>
        </div>
      )}

      <CandidateTotalsPanel candidates={candidates} mode="seats" />

      <ResultsTable
        units={units}
        candidatesById={candidatesById}
        unitLabel="Region"
        title={national ? "This region" : "Region result"}
      />
    </div>
  );
}
