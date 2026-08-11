"use client";

import { COMMODITY_LABELS } from "@/lib/constants/commodities";
import type { ProspectingSurveyRow } from "./types";

interface ProspectingSurveyListProps {
  surveys: ProspectingSurveyRow[];
  currentTurn: number;
  loading?: boolean;
}

/**
 * Active + recently resolved geological surveys for a scope (a corp's surveys
 * in one state, or a government's surveys in a state/country). Shared by the
 * corp sector detail panel, the state resources tab, and the national
 * executive surface.
 */
export function ProspectingSurveyList({
  surveys,
  currentTurn,
  loading = false,
}: ProspectingSurveyListProps) {
  if (loading) {
    return (
      <div className="py-4 text-center text-xs text-muted animate-pulse">Loading surveys…</div>
    );
  }

  const active = surveys.filter((s) => s.status === "active");
  const resolved = surveys
    .filter((s) => s.status !== "active")
    .sort((a, b) => (b.resolvedTurn ?? 0) - (a.resolvedTurn ?? 0))
    .slice(0, 5);

  if (active.length === 0 && resolved.length === 0) {
    return <p className="text-xs text-muted">No geological surveys yet.</p>;
  }

  return (
    <div className="space-y-3">
      {active.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-muted">
            Active surveys
          </p>
          {active.map((s) => {
            const turnsLeft = Math.max(0, s.completesTurn - currentTurn);
            return (
              <div
                key={s._id}
                className="flex items-center justify-between rounded-lg border border-card-border bg-card-elevated/40 px-3 py-2 text-sm"
              >
                <span className="font-medium text-foreground">
                  {COMMODITY_LABELS[s.resource] ?? s.resource}
                </span>
                <span className="text-xs text-muted tabular-nums">
                  {turnsLeft === 0
                    ? "Resolving next turn"
                    : `${turnsLeft} turn${turnsLeft === 1 ? "" : "s"} left`}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {resolved.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-muted">
            Recent outcomes
          </p>
          {resolved.map((s) => (
            <div
              key={s._id}
              className="flex items-center justify-between rounded-lg border border-card-border px-3 py-2 text-sm"
            >
              <span className="font-medium text-foreground">
                {COMMODITY_LABELS[s.resource] ?? s.resource}
              </span>
              {s.status === "succeeded" ? (
                <span className="text-xs font-medium text-success">
                  Struck deposits
                  {s.capacityGained ? ` (+${s.capacityGained.toLocaleString("en-US")})` : ""}
                </span>
              ) : (
                <span className="text-xs font-medium text-muted">Came up dry</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
