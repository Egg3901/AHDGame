"use client";

import { Tooltip } from "@/components/Tooltip";
import { formatNum, appealColor } from "../../pollHelpers";
import type { StoredPoll } from "../../types";

function weightedGranularTurnout(poll: StoredPoll): number | null {
  const cells = poll.granular?.cells;
  if (!cells?.length) return null;
  const share = cells.reduce((s, c) => s + c.share, 0);
  if (share <= 0) return null;
  return cells.reduce((s, c) => s + c.share * c.turnout, 0) / share;
}

export function StatCards({ poll }: { poll: StoredPoll }) {
  const { overallAppeal, totalEstimatedVoters } = poll;
  const turnoutPct = weightedGranularTurnout(poll);

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
        <div className="text-xs text-muted mt-0.5">
          {turnoutPct != null
            ? `${turnoutPct.toFixed(1)}% weighted turnout across groups`
            : "Weighted turnout across groups"}
        </div>
      </div>
    </div>
  );
}
