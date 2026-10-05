"use client";

import { GameMonthTime } from "@/components/time/GameMonthTime";
import { formatNum } from "../pollHelpers";
import { PollTrendChart } from "./PollTrendChart";

export type RecentPollEntry = {
  takenAt: string;
  tier: "small" | "large";
  stateName: string;
  overallAppeal: number;
  totalEstimatedVoters: number;
  inRaceVoteShare?: number | null;
};

/** The player's last few polls on this device: an appeal trend, then one row per poll. */
export function RecentPolls({ polls, limit }: { polls: RecentPollEntry[]; limit: number }) {
  if (polls.length === 0) return null;
  return (
    <section aria-labelledby="poll-recent-heading">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4">
        <h2 id="poll-recent-heading" className="text-heading font-semibold">
          Recent polls
        </h2>
        <p className="text-body-sm text-muted">Last {limit}, saved on this device</p>
      </div>

      <PollTrendChart polls={polls} />

      <ul className="mt-4 divide-y divide-card-border">
        {polls.map((p, i) => (
          <li
            key={`${p.takenAt}-${i}`}
            className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1 py-3"
          >
            <div className="min-w-0">
              <div className="truncate text-body font-medium">
                {p.stateName || "Poll"}
                <span className="ml-2 text-body-sm font-normal text-muted">
                  {p.tier === "large" ? "Full poll" : "Quick poll"}
                </span>
              </div>
              <div className="text-body-sm text-muted">
                <GameMonthTime value={p.takenAt} />
              </div>
            </div>
            <dl className="flex shrink-0 gap-6 text-right">
              <div>
                <dt className="text-body-sm text-muted">Appeal</dt>
                <dd className="text-body font-semibold tabular-nums">
                  {p.overallAppeal.toFixed(1)}
                </dd>
              </div>
              <div>
                <dt className="text-body-sm text-muted">Est. voters</dt>
                <dd className="text-body font-semibold tabular-nums">
                  {formatNum(p.totalEstimatedVoters)}
                </dd>
              </div>
              {typeof p.inRaceVoteShare === "number" && (
                <div>
                  <dt className="text-body-sm text-muted">Vote share</dt>
                  <dd className="text-body font-semibold tabular-nums">
                    {p.inRaceVoteShare.toFixed(1)}%
                  </dd>
                </div>
              )}
            </dl>
          </li>
        ))}
      </ul>
    </section>
  );
}
