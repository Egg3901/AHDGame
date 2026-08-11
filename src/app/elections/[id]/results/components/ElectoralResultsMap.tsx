"use client";

import { useMemo } from "react";
import { USAMapPaths, type StateMapData } from "@/components/USAMapPaths";
import type { ResultsCandidate, ResultsUnit } from "@/lib/elections/liveResults/types";
import { formatMargin } from "./resultsFormat";

interface ElectoralResultsMapProps {
  units: ResultsUnit[];
  candidatesById: Map<string, ResultsCandidate>;
}

const CD_PATTERN = /^([A-Z]{2})_CD(\d)$/;

/**
 * Election-night US map: states fill with the leader's party color — solid
 * once called, translucent while only leading — so calls visibly "lock in"
 * as the final-hour drip reveals them. ME/NE district units fold into their
 * parent state's tooltip.
 */
export function ElectoralResultsMap({ units, candidatesById }: ElectoralResultsMapProps) {
  const stateData = useMemo(() => {
    const byState: Record<string, StateMapData> = {};
    const cdLines = new Map<string, string[]>();

    for (const unit of units) {
      const cd = unit.id.match(CD_PATTERN);
      if (!cd) continue;
      const leader = unit.leaderId ? candidatesById.get(unit.leaderId) : undefined;
      const status = unit.called ? "✓ called" : unit.totalVotes > 0 ? "counting" : "waiting";
      const lines = cdLines.get(cd[1]) ?? [];
      lines.push(`CD-${cd[2]} (${unit.weight} EV): ${leader?.name ?? "—"} · ${status}`);
      cdLines.set(cd[1], lines);
    }

    for (const unit of units) {
      if (CD_PATTERN.test(unit.id)) continue;
      const leader = unit.leaderId ? candidatesById.get(unit.leaderId) : undefined;
      const tooltip = [
        `${unit.name} · ${unit.weight} EV`,
        leader
          ? `${leader.name} ${unit.tied ? "· Tied" : formatMargin(unit.leaderMargin, unit.leaderMarginPct)}`
          : "No votes reported",
        unit.called
          ? "✓ Called"
          : unit.totalVotes > 0
            ? `Too close · ${unit.reportingPct}% in`
            : "Waiting",
        ...(cdLines.get(unit.id) ?? []),
      ];
      byState[unit.id] = {
        color: leader && !unit.tied ? leader.partyColor : "#64748B",
        tooltip,
        phase: unit.called ? "actual" : leader ? "projected" : undefined,
      };
    }
    return byState;
  }, [units, candidatesById]);

  return (
    <div className="rounded-xl border border-card-border bg-card p-5">
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">Electoral map</h3>
        <span className="text-xs text-muted">solid = called · faded = leading</span>
      </div>
      <USAMapPaths stateData={stateData} />
    </div>
  );
}
