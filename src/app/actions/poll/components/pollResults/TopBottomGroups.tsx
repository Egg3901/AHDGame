"use client";

import { Tooltip } from "@/components/Tooltip";
import { formatNum } from "../../pollHelpers";
import { DE_GROUP_EN_LABELS } from "@/lib/seeds/de/deDemographicCategories";
import type { StoredPoll, GroupResult } from "../../types";

export function TopBottomGroups({ poll }: { poll: StoredPoll }) {
  const { topGroups, bottomGroups } = poll;

  const allZero = topGroups.every((g) => g.weightedPotential === 0);

  if (allZero) {
    return (
      <div className="mb-6 rounded-xl border border-card-border bg-card p-6 text-center">
        <div className="text-muted/60 mb-2 text-lg">No reachable voters yet</div>
        <p className="text-sm text-muted/50 max-w-md mx-auto">
          All voter groups show 0 reachable voters. To improve your numbers:
        </p>
        <ul className="mt-3 text-sm text-muted/70 space-y-1 max-w-md mx-auto text-left">
          <li>
            <span className="text-purple-400">&#x2022;</span> Raise your{" "}
            <span className="text-purple-400 font-medium">political influence</span> to reach more
            voters
          </li>
          <li>
            <span className="text-yellow-400">&#x2022;</span> Improve{" "}
            <span className="text-yellow-400 font-medium">favorability</span> so voters who know you
            will support you
          </li>
          <li>
            <span className="text-blue-400">&#x2022;</span> Adjust your{" "}
            <span className="text-blue-400 font-medium">positions</span> to align with voter groups
            in your state
          </li>
        </ul>
      </div>
    );
  }

  return (
    <div className="mb-6 grid gap-4 md:grid-cols-2">
      <GroupList
        groups={topGroups}
        title="Most Reachable Voters"
        titleColor="text-green-400"
        valueColor="text-green-400"
        borderColor="border-green-500/20"
        bgColor="bg-green-500/5"
        tooltip="The 5 voter groups where your combination of appeal and reach yields the most reachable voters."
        icon={
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M5 10l7-7m0 0l7 7m-7-7v18"
          />
        }
      />
      <GroupList
        groups={bottomGroups}
        title="Fewest Reachable Voters"
        titleColor="text-red-400"
        valueColor="text-red-400"
        borderColor="border-red-500/20"
        bgColor="bg-red-500/5"
        tooltip="The 5 voter groups where you have the fewest reachable voters."
        icon={
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M19 14l-7 7m0 0l-7-7m7 7V3"
          />
        }
      />
    </div>
  );
}

function GroupList({
  groups,
  title,
  titleColor,
  valueColor,
  borderColor,
  bgColor,
  tooltip,
  icon,
}: {
  groups: GroupResult[];
  title: string;
  titleColor: string;
  valueColor: string;
  borderColor: string;
  bgColor: string;
  tooltip: string;
  icon: React.ReactNode;
}) {
  return (
    <div className={`rounded-xl border ${borderColor} ${bgColor} p-4`}>
      <div className="flex items-center gap-2 mb-3">
        <svg
          className={`h-4 w-4 ${titleColor}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          {icon}
        </svg>
        <Tooltip content={tooltip}>
          <span className={`text-sm font-semibold ${titleColor}`}>{title}</span>
        </Tooltip>
      </div>
      <div className="space-y-2">
        {groups.map((g) => (
          <div key={`${g.categoryId}-${g.id}`} className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <span className="text-sm font-medium">{g.name}</span>
              {DE_GROUP_EN_LABELS[g.id] && (
                <span className="ml-1.5 text-xs text-muted">({DE_GROUP_EN_LABELS[g.id]})</span>
              )}
              {g.archetypeApproval != null && g.archetypeApproval !== 0 && (
                <span
                  className={`ml-1.5 text-xs ${g.archetypeApproval > 0 ? "text-green-400/70" : "text-red-400/70"}`}
                  title={`Archetype approval modifier: ${g.archetypeApproval > 0 ? "+" : ""}${g.archetypeApproval.toFixed(0)}`}
                >
                  {g.archetypeApproval > 0 ? "+" : ""}
                  {g.archetypeApproval.toFixed(0)} approval
                </span>
              )}
            </div>
            <div className="flex items-center gap-3 shrink-0">
              {g.estimatedSharePct != null && (
                <span className="text-xs text-yellow-400/90" title="Est. share when in race">
                  {g.estimatedSharePct.toFixed(0)}% share
                </span>
              )}
              <span className="text-xs text-muted">{g.appeal.toFixed(1)} appeal</span>
              <span className={`text-sm font-semibold ${valueColor} tabular-nums w-14 text-right`}>
                {formatNum(g.weightedPotential)}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
