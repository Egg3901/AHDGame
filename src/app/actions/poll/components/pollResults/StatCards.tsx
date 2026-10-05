"use client";

import { Tooltip } from "@/components/Tooltip";
import { formatNum, formatTimestamp, appealColor, appealBand, appealFill } from "../../pollHelpers";
import type { StoredPoll } from "../../types";

function weightedGranularTurnout(poll: StoredPoll): number | null {
  const cells = poll.granular?.cells;
  if (!cells?.length) return null;
  const share = cells.reduce((s, c) => s + c.share, 0);
  if (share <= 0) return null;
  return cells.reduce((s, c) => s + c.share * c.turnout, 0) / share;
}

/** The poll's lead numbers: appeal first and largest, then the voter counts. */
export function StatCards({ poll }: { poll: StoredPoll }) {
  const { overallAppeal, totalEstimatedVoters, totalPotentialVoters } = poll;
  const turnoutPct = weightedGranularTurnout(poll);
  const reachPct =
    totalEstimatedVoters > 0 ? (totalPotentialVoters / totalEstimatedVoters) * 100 : null;

  return (
    <section
      aria-labelledby="poll-results-heading"
      className="rounded-lg border border-card-border bg-card p-5 sm:p-6"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id="poll-results-heading" className="text-heading font-semibold">
          Poll results
        </h2>
        <p className="text-body-sm text-muted">
          Taken {formatTimestamp(poll.takenAt)}. Commission a new poll to refresh.
        </p>
      </div>

      <dl className="mt-5 grid gap-x-12 gap-y-6 sm:grid-cols-[minmax(0,1.3fr)_repeat(2,minmax(0,1fr))]">
        <div>
          <dt className="text-body-sm text-muted">
            <Tooltip content="A weighted average of your appeal score (0 to 50) across every voter group in your state.">
              Overall appeal
            </Tooltip>
          </dt>
          <dd className="mt-1">
            <div className="flex items-baseline gap-2">
              <span className={`text-display font-bold tabular-nums ${appealColor(overallAppeal)}`}>
                {overallAppeal.toFixed(1)}
              </span>
              <span className="text-body text-muted">of 50</span>
              <span className={`ml-1 text-body font-semibold ${appealColor(overallAppeal)}`}>
                {appealBand(overallAppeal)}
              </span>
            </div>
            <div
              className="mt-2 h-2 w-full max-w-xs overflow-hidden rounded-full bg-card-border"
              role="img"
              aria-label={`Appeal ${overallAppeal.toFixed(1)} out of 50, ${appealBand(overallAppeal)}`}
            >
              <div
                className={`h-full rounded-full ${appealFill(overallAppeal)}`}
                style={{ width: `${Math.min(100, (overallAppeal / 50) * 100)}%` }}
              />
            </div>
          </dd>
        </div>
        <div>
          <dt className="text-body-sm text-muted">
            <Tooltip content="Total expected turnout voters across all voter groups.">
              Estimated voters
            </Tooltip>
          </dt>
          <dd className="mt-1">
            <div className="text-heading-lg font-semibold tabular-nums">
              {formatNum(totalEstimatedVoters)}
            </div>
            <div className="mt-1 text-body-sm text-muted">
              {turnoutPct != null
                ? `${turnoutPct.toFixed(1)}% weighted turnout`
                : "Weighted turnout across groups"}
            </div>
          </dd>
        </div>
        <div>
          <dt className="text-body-sm text-muted">
            <Tooltip content="Upper bound if you captured 100% of each group. In contested races, your actual share depends on opponents.">
              Reachable voters
            </Tooltip>
          </dt>
          <dd className="mt-1">
            <div className="text-heading-lg font-semibold tabular-nums text-secondary">
              {formatNum(totalPotentialVoters)}
            </div>
            <div className="mt-1 text-body-sm text-muted">
              {reachPct != null ? `${reachPct.toFixed(1)}% of estimated voters` : "Upper bound"}
            </div>
          </dd>
        </div>
      </dl>
    </section>
  );
}
