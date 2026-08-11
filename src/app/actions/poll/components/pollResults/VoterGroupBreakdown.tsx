"use client";

import { Tooltip } from "@/components/Tooltip";
import { formatNum, appealColor, getLeanRowBg } from "../../pollHelpers";
import { AppealBar, EconomicPositionPip, SocialPositionPip } from "../PollCharts";
import { DE_GROUP_EN_LABELS } from "@/lib/seeds/de/deDemographicCategories";
import type { StoredPoll, GroupResult } from "../../types";

export function VoterGroupBreakdown({
  poll,
  breakdownOpen,
  setBreakdownOpen,
}: {
  poll: StoredPoll;
  breakdownOpen: boolean;
  setBreakdownOpen: (updater: (v: boolean) => boolean) => void;
}) {
  // Flatten all groups from all categories into one sorted list
  const allGroups: GroupResult[] = (poll.categories ?? [])
    .flatMap((cat) => cat.groups)
    .sort((a, b) => b.weightedPotential - a.weightedPotential);

  const groupCount = allGroups.length;

  return (
    <div className="rounded-xl border border-card-border bg-card overflow-hidden">
      <button
        className="w-full text-left px-5 py-4 flex items-center gap-3 hover:bg-foreground/[0.03] transition-colors"
        onClick={() => setBreakdownOpen((v) => !v)}
      >
        <span className="text-xl shrink-0">📊</span>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <Tooltip content="Full per-group breakdown with population, turnout, reach, appeal, and reachable voters for every voter archetype.">
              <span className="font-semibold">Voter Group Breakdown</span>
            </Tooltip>
            <span className="text-xs text-muted">{groupCount} groups — full detail</span>
          </div>
        </div>
        <svg
          className={`h-4 w-4 text-muted shrink-0 transition-transform duration-200 ${breakdownOpen ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {breakdownOpen && (
        <div className="border-t border-card-border">
          <div className="divide-y divide-card-border/20">
            {allGroups.map((group) => {
              const combinedLean = (group.economicLean + group.socialLean) / 2;
              return (
                <div
                  key={`${group.categoryId}-${group.id}`}
                  className={`px-4 sm:px-5 py-3 ${getLeanRowBg(combinedLean)}`}
                >
                  {/* Row 1: Name + positions + appeal */}
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mb-1.5">
                    <div className="min-w-[120px] flex-1">
                      <span className="font-medium text-sm">{group.name}</span>
                      {DE_GROUP_EN_LABELS[group.id] && (
                        <span className="ml-1.5 text-xs text-muted font-normal">
                          ({DE_GROUP_EN_LABELS[group.id]})
                        </span>
                      )}
                      {group.archetypeApproval != null && group.archetypeApproval !== 0 && (
                        <Tooltip
                          content={`Archetype approval modifier: ${group.archetypeApproval > 0 ? "+" : ""}${group.archetypeApproval.toFixed(0)}. Adjusts this group's effective favorability toward you.`}
                        >
                          <span
                            className={`ml-1.5 text-xs cursor-help ${group.archetypeApproval > 0 ? "text-green-400/70" : "text-red-400/70"}`}
                          >
                            {group.archetypeApproval > 0 ? "+" : ""}
                            {group.archetypeApproval.toFixed(0)} appr.
                          </span>
                        </Tooltip>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 text-xs shrink-0">
                      <Tooltip content="This group's economic leaning">
                        <span className="cursor-help">
                          <EconomicPositionPip value={group.economicLean} />
                        </span>
                      </Tooltip>
                      <span className="text-muted/40">/</span>
                      <Tooltip content="This group's social leaning">
                        <span className="cursor-help">
                          <SocialPositionPip value={group.socialLean} />
                        </span>
                      </Tooltip>
                    </div>
                    <div className="shrink-0 text-right">
                      <Tooltip content="Your appeal score (0–50) with this group. Based on how closely your positions match theirs, plus influence and favorability.">
                        <span
                          className={`text-sm font-bold tabular-nums cursor-help ${appealColor(group.appeal)}`}
                        >
                          {group.appeal.toFixed(1)}
                        </span>
                      </Tooltip>
                      <span className="text-xs text-muted ml-1">appeal</span>
                    </div>
                  </div>

                  {/* Row 2: Stats line */}
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
                    <Tooltip content="This group's share of the state population.">
                      <span className="cursor-help">{group.populationPct}% pop</span>
                    </Tooltip>
                    <span className="text-muted/30">·</span>
                    <Tooltip content="Raw group population before turnout weighting.">
                      <span className="cursor-help tabular-nums">
                        {formatNum(group.groupPop)} voters
                      </span>
                    </Tooltip>
                    <span className="text-muted/30">·</span>
                    <Tooltip content="Expected turnout rate for this group, based on demographics.">
                      <span className="cursor-help">{group.turnoutPct}% turnout</span>
                    </Tooltip>
                    <span className="text-muted/30">·</span>
                    <Tooltip content="Your political reach — what fraction of this group knows you exist.">
                      <span className="cursor-help text-yellow-400/80">
                        {group.influencePct.toFixed(0)}% reach
                      </span>
                    </Tooltip>
                    <span className="text-muted/30">·</span>
                    <Tooltip content="Voters from this group you actually reach (population × turnout × reach).">
                      <span className="cursor-help tabular-nums">
                        {formatNum(group.reachedPop)} reached
                      </span>
                    </Tooltip>
                    {group.estimatedSharePct != null && (
                      <>
                        <span className="text-muted/30">·</span>
                        <Tooltip content="Your estimated vote share from this group in the current race.">
                          <span className="cursor-help text-yellow-400/90 font-medium">
                            {group.estimatedSharePct.toFixed(0)}% share
                          </span>
                        </Tooltip>
                      </>
                    )}
                    <div className="ml-auto shrink-0">
                      <Tooltip content="Upper-bound reachable voters: reached voters × (appeal ÷ 50).">
                        <span
                          className={`font-bold tabular-nums cursor-help text-sm ${appealColor(group.appeal)}`}
                        >
                          {formatNum(group.weightedPotential)}
                        </span>
                      </Tooltip>
                      <span className="text-muted/60 ml-1">reachable</span>
                    </div>
                  </div>

                  {/* Appeal bar */}
                  <div className="mt-1.5">
                    <AppealBar appeal={group.appeal} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
