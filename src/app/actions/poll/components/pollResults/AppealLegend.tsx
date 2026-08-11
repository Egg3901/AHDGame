"use client";

import { Tooltip } from "@/components/Tooltip";
import { formatNum } from "../../pollHelpers";
import type { StoredPoll } from "../../types";

export function AppealLegend({ poll }: { poll: StoredPoll }) {
  const { totalPotentialVoters, totalEstimatedVoters } = poll;
  const pctOfVoters =
    totalEstimatedVoters > 0
      ? `${((totalPotentialVoters / totalEstimatedVoters) * 100).toFixed(1)}% of estimated voters`
      : "—";

  return (
    <div className="mt-6 rounded-xl border border-card-border bg-card p-5">
      {/* Reachable voters headline */}
      <div className="flex items-center justify-between gap-4 mb-4">
        <div>
          <div className="text-xs text-muted uppercase tracking-wide mb-1">
            <Tooltip content="Upper bound if you captured 100% of each group. In contested races, your actual share depends on opponents.">
              Reachable Voters (upper bound)
            </Tooltip>
          </div>
          <div className="text-3xl font-bold text-secondary">{formatNum(totalPotentialVoters)}</div>
          <div className="text-xs text-muted mt-0.5">{pctOfVoters}</div>
        </div>
        <div className="flex flex-wrap gap-4 text-xs">
          <div className="flex items-center gap-1.5">
            <div className="h-2 w-6 rounded-full bg-green-500" />
            <span className="text-muted">35+ Strong</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="h-2 w-6 rounded-full bg-yellow-500" />
            <span className="text-muted">20–35 Moderate</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="h-2 w-6 rounded-full bg-orange-500" />
            <span className="text-muted">10–20 Weak</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="h-2 w-6 rounded-full bg-red-500" />
            <span className="text-muted">&lt;10 Very Weak</span>
          </div>
        </div>
      </div>

      <div className="border-t border-card-border/50 pt-4">
        <div className="text-xs text-muted uppercase tracking-wide mb-3">
          What affects your poll numbers
        </div>
        <div className="grid gap-3 sm:grid-cols-2 text-sm text-muted/80">
          <div className="flex gap-2">
            <span className="text-blue-400 shrink-0">1.</span>
            <div>
              <span className="font-medium text-foreground/80">Position alignment</span> — How
              closely your economic and social positions match each voter group. The closer you are,
              the higher your appeal (up to 25 pts).
            </div>
          </div>
          <div className="flex gap-2">
            <span className="text-purple-400 shrink-0">2.</span>
            <div>
              <span className="font-medium text-foreground/80">Political influence</span> — Your
              name recognition determines what fraction of voters you can reach. Low influence means
              most voters don&apos;t know you exist.
            </div>
          </div>
          <div className="flex gap-2">
            <span className="text-yellow-400 shrink-0">3.</span>
            <div>
              <span className="font-medium text-foreground/80">Favorability</span> — Voters who
              don&apos;t approve of you won&apos;t vote for you, even if your positions align.
              Scales your reachable voters from 0% to 100%.
            </div>
          </div>
          <div className="flex gap-2">
            <span className="text-emerald-400 shrink-0">4.</span>
            <div>
              <span className="font-medium text-foreground/80">Party organization</span> — Your
              party&apos;s ground game in this state. Stronger organization means better
              mobilization. Independents are unaffected.
            </div>
          </div>
        </div>
        <div className="mt-3 text-xs text-muted/50 italic">
          In contested races, your share of each voter group is split proportionally among all
          candidates based on these same factors.
        </div>
      </div>
    </div>
  );
}
