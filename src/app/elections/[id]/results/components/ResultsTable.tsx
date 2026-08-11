"use client";

import { useMemo, useState } from "react";
import type { ResultsCandidate, ResultsUnit } from "@/lib/elections/liveResults/types";
import { formatVotes } from "./resultsFormat";

type SortKey = "margin" | "name" | "reporting";

interface ResultsTableProps {
  units: ResultsUnit[];
  candidatesById: Map<string, ResultsCandidate>;
  /** Column header for the unit name column (e.g. "State", "Region"). */
  unitLabel: string;
  /** Panel heading. */
  title: string;
}

function statusLabel(unit: ResultsUnit): { text: string; className: string } {
  if (unit.totalVotes === 0) return { text: "Not reporting", className: "text-muted" };
  if (unit.tied) return { text: "Tied", className: "text-warning" };
  if (unit.called) return { text: "Called", className: "text-success" };
  return { text: "Too close", className: "text-warning" };
}

/** Sortable table of every unit. Default sort: closest margins first. */
export function ResultsTable({ units, candidatesById, unitLabel, title }: ResultsTableProps) {
  const [sortKey, setSortKey] = useState<SortKey>("margin");

  const sorted = useMemo(() => {
    const rows = [...units];
    switch (sortKey) {
      case "name":
        rows.sort((a, b) => a.name.localeCompare(b.name));
        break;
      case "reporting":
        rows.sort((a, b) => b.reportingPct - a.reportingPct);
        break;
      case "margin":
      default:
        // Closest contested races first; silent units sink to the bottom.
        rows.sort((a, b) => {
          if ((a.totalVotes === 0) !== (b.totalVotes === 0)) return a.totalVotes === 0 ? 1 : -1;
          return a.leaderMarginPct - b.leaderMarginPct;
        });
        break;
    }
    return rows;
  }, [units, sortKey]);

  if (units.length === 0) {
    return (
      <div className="rounded-xl border border-card-border bg-card p-5 text-center text-sm text-muted">
        No results reported yet.
      </div>
    );
  }

  const headerButton = (key: SortKey, label: string, alignRight = false) => (
    <button
      type="button"
      onClick={() => setSortKey(key)}
      className={`text-[11px] font-semibold uppercase tracking-wider transition-colors ${
        sortKey === key ? "text-foreground" : "text-muted hover:text-foreground"
      } ${alignRight ? "text-right" : "text-left"}`}
    >
      {label}
      {sortKey === key ? " ↓" : ""}
    </button>
  );

  return (
    <div className="rounded-xl border border-card-border bg-card p-5">
      <h3 className="mb-3 text-sm font-semibold">{title}</h3>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm">
          <thead>
            <tr className="border-b border-card-border">
              <th className="pb-2 pr-3">{headerButton("name", unitLabel)}</th>
              <th className="pb-2 pr-3 text-left text-[11px] font-semibold uppercase tracking-wider text-muted">
                Leader
              </th>
              <th className="pb-2 pr-3 text-right text-[11px] font-semibold uppercase tracking-wider text-muted">
                Votes
              </th>
              <th className="pb-2 pr-3 text-right">{headerButton("margin", "Margin", true)}</th>
              <th className="pb-2 pr-3 text-right">{headerButton("reporting", "In", true)}</th>
              <th className="pb-2 text-right text-[11px] font-semibold uppercase tracking-wider text-muted">
                Status
              </th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((unit) => {
              const leader = unit.leaderId ? candidatesById.get(unit.leaderId) : undefined;
              const status = statusLabel(unit);
              return (
                <tr key={unit.id} className="border-b border-card-border/50 last:border-0">
                  <td className="py-2 pr-3 font-medium">{unit.name}</td>
                  <td className="py-2 pr-3">
                    {leader ? (
                      <span className="inline-flex items-center gap-1.5">
                        <span
                          className="h-2 w-2 rounded-full"
                          style={{ backgroundColor: leader.partyColor }}
                        />
                        <span className="truncate">{leader.name}</span>
                      </span>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">
                    {formatVotes(unit.totalVotes)}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">
                    {unit.totalVotes > 0 && !unit.tied
                      ? `${unit.leaderMarginPct.toFixed(1)}%`
                      : "—"}
                  </td>
                  <td className="py-2 pr-3 text-right text-muted tabular-nums">
                    {unit.reportingPct}%
                  </td>
                  <td className={`py-2 text-right text-xs font-medium ${status.className}`}>
                    {status.text}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
