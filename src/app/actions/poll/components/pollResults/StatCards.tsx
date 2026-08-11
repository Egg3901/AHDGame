"use client";

import { Tooltip } from "@/components/Tooltip";
import { formatNum, appealColor } from "../../pollHelpers";
import type { StoredPoll } from "../../types";

export function StatCards({ poll }: { poll: StoredPoll }) {
  const { overallAppeal, totalEstimatedVoters } = poll;

  return (
    <div className="mb-4 grid gap-4 sm:grid-cols-2">
      <div className="rounded-xl border border-card-border bg-card p-4">
        <div className="text-xs text-muted uppercase tracking-wide mb-1">
          <Tooltip content="A weighted average of your appeal score (0–50) across every voter group in your state.">
            Overall Appeal
          </Tooltip>
        </div>
        <div className={`text-2xl font-bold ${appealColor(overallAppeal)}`}>
          {overallAppeal.toFixed(1)}
          <span className="text-sm text-muted ml-1">/ 50</span>
        </div>
        <div className="text-xs text-muted mt-0.5">Weighted avg across all groups</div>
      </div>
      <div className="rounded-xl border border-card-border bg-card p-4">
        <div className="text-xs text-muted uppercase tracking-wide mb-1">
          <Tooltip content="Total expected turnout voters across all voter groups.">
            Est. Total Voters
          </Tooltip>
        </div>
        <div className="text-2xl font-bold text-foreground">{formatNum(totalEstimatedVoters)}</div>
        <div className="text-xs text-muted mt-0.5">Weighted turnout across groups</div>
      </div>
    </div>
  );
}
