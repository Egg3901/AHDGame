"use client";

import { Tooltip } from "@/components/Tooltip";
import { formatNum, appealColor, getLeanRowBg } from "../../pollHelpers";
import { EconomicPositionPip, SocialPositionPip } from "../PollCharts";
import { DE_GROUP_EN_LABELS } from "@/lib/seeds/de/deDemographicCategories";
import type { StoredPoll } from "../../types";

export function ToplineByVoterGroup({
  poll,
  toplineOpen,
  setToplineOpen,
}: {
  poll: StoredPoll;
  toplineOpen: boolean;
  setToplineOpen: (updater: (v: boolean) => boolean) => void;
}) {
  // Find the main voter groups category
  const ideologyCat = poll.categories!.find(
    (c) =>
      c.id === "voterGroups" ||
      c.id === "uk_voterGroups" ||
      c.id === "de_voterGroups" ||
      c.id === "ideology"
  );
  if (!ideologyCat) return null;

  const topAppeal =
    ideologyCat.groups.length > 0 ? Math.max(...ideologyCat.groups.map((g) => g.appeal)) : 0;

  return (
    <div className="rounded-xl border border-card-border bg-card overflow-hidden">
      <button
        className="w-full text-left px-5 py-4 flex items-center gap-3 hover:bg-foreground/[0.03] transition-colors"
        onClick={() => setToplineOpen((v) => !v)}
      >
        <span className="text-xl shrink-0">🗳️</span>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <Tooltip content="Your appeal and reachable voters per voter group. Group sizes are weighted by turnout.">
              <span className="font-semibold">Topline — by Voter Group</span>
            </Tooltip>
            <span className={`text-xs font-medium ${appealColor(topAppeal)}`}>
              best {topAppeal.toFixed(1)} appeal
            </span>
            <span className="text-xs text-muted">{ideologyCat.groups.length} groups</span>
          </div>
        </div>
        <svg
          className={`h-4 w-4 text-muted shrink-0 transition-transform duration-200 ${toplineOpen ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {toplineOpen && (
        <div className="border-t border-card-border">
          <div className="divide-y divide-card-border/20">
            {ideologyCat.groups
              .slice()
              .sort((a, b) => b.weightedPotential - a.weightedPotential)
              .map((g) => (
                <div
                  key={g.id}
                  className={`px-5 py-3 flex flex-wrap items-center gap-x-4 gap-y-2 ${getLeanRowBg((g.economicLean + g.socialLean) / 2)}`}
                >
                  <div className="flex-1 min-w-[140px]">
                    <div className="font-medium text-sm">
                      {g.name}
                      {DE_GROUP_EN_LABELS[g.id] && (
                        <span className="ml-1.5 text-xs text-muted font-normal">
                          ({DE_GROUP_EN_LABELS[g.id]})
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-muted">
                      {g.populationPct.toFixed(1)}% of electorate
                    </div>
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    <Tooltip content="This group's economic leaning">
                      <span className="cursor-help">
                        <EconomicPositionPip value={g.economicLean} />
                      </span>
                    </Tooltip>
                    <span className="text-muted/40">/</span>
                    <Tooltip content="This group's social leaning">
                      <span className="cursor-help">
                        <SocialPositionPip value={g.socialLean} />
                      </span>
                    </Tooltip>
                  </div>
                  <div className="text-right text-xs text-muted w-24 hidden sm:block">
                    <div>{formatNum(g.groupPop)} voters</div>
                    <Tooltip content="Composite turnout rate derived from this group's demographic mix (age, income, education, race).">
                      <span className="cursor-help underline decoration-dotted">
                        {g.turnoutPct}% turnout
                      </span>
                    </Tooltip>
                  </div>
                  <div className="text-right w-24">
                    <Tooltip content="Your appeal score (0–50) with this group. Based on position alignment, influence, and favorability.">
                      <div
                        className={`text-sm font-bold tabular-nums cursor-help ${appealColor(g.appeal)}`}
                      >
                        {g.appeal.toFixed(1)}{" "}
                        <span className="text-xs font-normal text-muted">appeal</span>
                      </div>
                    </Tooltip>
                    {g.estimatedSharePct != null && (
                      <Tooltip content="Your estimated vote share from this group when competing against opponents.">
                        <div className="text-xs text-yellow-400/90 cursor-help">
                          {g.estimatedSharePct.toFixed(0)}% share
                        </div>
                      </Tooltip>
                    )}
                  </div>
                  <div className="text-right w-20">
                    <Tooltip content="Upper-bound reachable voters from this group: population × reach × (appeal ÷ 50).">
                      <div
                        className={`text-sm font-bold tabular-nums cursor-help ${appealColor(g.appeal)}`}
                      >
                        {formatNum(g.weightedPotential)}
                      </div>
                    </Tooltip>
                    <div className="text-xs text-muted">reachable</div>
                  </div>
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}
