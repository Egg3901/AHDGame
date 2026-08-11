"use client";

import type { ResultsCandidate, ResultsUnit } from "@/lib/elections/liveResults/types";
import { formatMargin } from "./resultsFormat";

interface RaceResultCardProps {
  unit: ResultsUnit;
  candidatesById: Map<string, ResultsCandidate>;
  /** Grid index — staggers the entrance animation. */
  index: number;
  weightLabel: "EV" | "seats";
}

/**
 * One state/district tile on the results board. Slides in staggered by index;
 * flashes when called. Keyed by `${unit.id}:${unit.called}` upstream so the
 * call transition re-mounts it and both animations replay.
 */
export function RaceResultCard({ unit, candidatesById, index, weightLabel }: RaceResultCardProps) {
  const leader = unit.leaderId ? candidatesById.get(unit.leaderId) : undefined;
  const notReporting = unit.totalVotes === 0;

  return (
    <div
      className={`results-card-in rounded-lg border bg-card p-3 ${
        unit.called ? "results-called-flash border-success/40" : "border-card-border"
      }`}
      style={{ animationDelay: `${Math.min(index, 20) * 45}ms` }}
    >
      <div className="mb-1.5 flex items-start justify-between gap-2">
        <span className="truncate text-sm font-semibold" title={unit.name}>
          {unit.name}
        </span>
        {unit.weight > 0 && (
          <span className="shrink-0 rounded bg-card-border/60 px-1.5 py-0.5 text-[10px] font-semibold text-muted tabular-nums">
            {unit.weight} {weightLabel}
          </span>
        )}
      </div>

      {notReporting ? (
        <p className="text-xs italic text-muted">No votes reported</p>
      ) : (
        <>
          <div className="flex items-center gap-1.5 text-xs">
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ backgroundColor: leader?.partyColor ?? "#9CA3AF" }}
            />
            <span className="truncate font-medium">{leader?.name ?? "—"}</span>
          </div>
          <div className="mt-0.5 text-[11px] text-muted tabular-nums">
            {unit.tied ? "Tied" : formatMargin(unit.leaderMargin, unit.leaderMarginPct)}
          </div>
        </>
      )}

      <div className="mt-2 flex items-center gap-2">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-card-border">
          <div
            className="h-full rounded-full transition-[width] duration-1000 ease-out"
            style={{
              width: `${unit.reportingPct}%`,
              backgroundColor: unit.called
                ? (leader?.partyColor ?? "var(--success)")
                : "var(--muted)",
            }}
          />
        </div>
        <span className="w-8 text-right text-[10px] text-muted tabular-nums">
          {unit.reportingPct}%
        </span>
      </div>

      <div className="mt-1.5">
        {unit.tied ? (
          <span className="text-[10px] font-semibold uppercase tracking-wider text-warning">
            Tied
          </span>
        ) : unit.called ? (
          <span className="text-[10px] font-semibold uppercase tracking-wider text-success">
            ✓ Called
          </span>
        ) : notReporting ? (
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted">
            Waiting
          </span>
        ) : (
          <span className="text-[10px] font-semibold uppercase tracking-wider text-warning">
            Too close to call
          </span>
        )}
      </div>
    </div>
  );
}
