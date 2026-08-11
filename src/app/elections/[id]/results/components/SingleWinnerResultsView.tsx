"use client";

import { useMemo } from "react";
import type { ElectionResultsResponse } from "@/lib/elections/liveResults/types";
import { CandidateTotalsPanel } from "./CandidateTotalsPanel";
import { RaceResultCard } from "./RaceResultCard";

/**
 * Head-to-head layout for single-winner races (senate seats, governors,
 * prime minister, chancellor…): candidate bars plus the race status card.
 */
export function SingleWinnerResultsView({ data }: { data: ElectionResultsResponse }) {
  const { candidates, units, summary } = data;
  const candidatesById = useMemo(() => new Map(candidates.map((c) => [c.id, c])), [candidates]);

  return (
    <div className="space-y-4">
      <CandidateTotalsPanel
        candidates={candidates}
        mode="votes"
        projectedWinner={summary.projectedWinner}
      />
      {units.length > 0 && (
        <div className="grid grid-cols-1 gap-2 sm:max-w-sm">
          {units.map((unit, i) => (
            <RaceResultCard
              key={`${unit.id}:${unit.called}`}
              unit={unit}
              candidatesById={candidatesById}
              index={i}
              weightLabel="seats"
            />
          ))}
        </div>
      )}
    </div>
  );
}
