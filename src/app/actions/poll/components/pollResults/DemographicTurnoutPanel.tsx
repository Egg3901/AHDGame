"use client";

import { Tooltip } from "@/components/Tooltip";
import { formatNum } from "../../pollHelpers";
import type { DemographicTurnoutData } from "../../types";

const DEMOGRAPHIC_SECTIONS: Array<{
  key: keyof DemographicTurnoutData;
  icon: string;
  label: string;
  tooltip: string;
}> = [
  {
    key: "race",
    icon: "👥",
    label: "Race / Ethnicity",
    tooltip:
      "Estimated voter turnout and count by racial/ethnic group. Turnout rates are national baselines; population shares are state-specific.",
  },
  {
    key: "age",
    icon: "📅",
    label: "Age Group",
    tooltip:
      "Older voters consistently turn out at higher rates. This affects which voter archetypes are larger in your state's modeled electorate.",
  },
  {
    key: "education",
    icon: "🎓",
    label: "Education",
    tooltip:
      "College and graduate-degree holders vote at significantly higher rates, boosting groups like Secular Professionals and College Liberals.",
  },
  {
    key: "wealth",
    icon: "💰",
    label: "Income",
    tooltip:
      "Higher-income voters have stronger turnout, lifting groups like Small Business and Secular Professionals in voter-weighted estimates.",
  },
];

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

function formatPercent(value: number): string {
  return clampPercent(value).toLocaleString("en-US", {
    maximumFractionDigits: 1,
  });
}

export function DemographicTurnoutPanel({
  demographicTurnout,
  demoTurnoutOpen,
  setDemoTurnoutOpen,
}: {
  demographicTurnout: DemographicTurnoutData;
  demoTurnoutOpen: boolean;
  setDemoTurnoutOpen: (updater: (v: boolean) => boolean) => void;
}) {
  // Each demographic dimension (race/age/education/wealth) is the same population
  // sliced a different way, so summing across dimensions would count each voter
  // ~4×. Average the per-dimension turnout totals instead.
  const allTurnoutPop = Math.round(
    DEMOGRAPHIC_SECTIONS.reduce(
      (s, sec) => s + demographicTurnout[sec.key].reduce((a, e) => a + e.turnoutPop, 0),
      0
    ) / DEMOGRAPHIC_SECTIONS.length
  );

  return (
    <div className="rounded-xl border border-card-border bg-card overflow-hidden">
      <button
        className="w-full text-left px-5 py-4 flex items-center gap-3 hover:bg-foreground/[0.03] transition-colors"
        onClick={() => setDemoTurnoutOpen((v) => !v)}
      >
        <span className="text-xl shrink-0">🗳️</span>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <Tooltip content="Effective turnout rates by demographic slice (national baseline ± any GOTV/canvassing/suppression modifier currently on your state), applied to your state's population. Matches the rates the election engine uses.">
              <span className="font-semibold">Likely Voter Turnout by Demographic</span>
            </Tooltip>
            <span className="text-xs text-muted">{formatNum(allTurnoutPop)} est. total voters</span>
          </div>
        </div>
        <svg
          className={`h-4 w-4 text-muted shrink-0 transition-transform duration-200 ${demoTurnoutOpen ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {demoTurnoutOpen && (
        <div className="border-t border-card-border">
          <div className="px-5 py-2 text-xs text-muted/70 italic border-b border-card-border/30">
            Turnout rates are national baselines adjusted for any active GOTV / canvassing /
            suppression modifier on your state. Population shares are state-specific. Est. voters =
            state pop × group % × turnout rate.
          </div>
          <div className="divide-y divide-card-border/30">
            {DEMOGRAPHIC_SECTIONS.map(({ key, icon, label, tooltip }) => {
              const entries = demographicTurnout[key]
                .slice()
                .sort((a, b) => b.turnoutPop - a.turnoutPop);
              const totalTurnoutPop = entries.reduce((s, e) => s + e.turnoutPop, 0);
              return (
                <div key={key} className="px-5 py-4">
                  <div className="flex items-center gap-2 mb-2.5">
                    <span>{icon}</span>
                    <Tooltip content={tooltip}>
                      <span className="text-sm font-semibold cursor-help">{label}</span>
                    </Tooltip>
                    <span className="text-xs text-muted ml-auto">
                      {formatNum(totalTurnoutPop)} est. voters
                    </span>
                  </div>
                  <div className="space-y-2">
                    {entries.map((e) => (
                      <div
                        key={e.key}
                        className="grid grid-cols-[minmax(0,1fr)_4rem_4.5rem_4rem] items-center gap-x-3 gap-y-1 text-xs sm:grid-cols-[9rem_minmax(6rem,1fr)_4rem_4.5rem_4rem]"
                      >
                        <span className="truncate text-muted">{e.label}</span>
                        <div className="order-last col-span-4 h-1.5 overflow-hidden rounded-full bg-card-border sm:order-none sm:col-span-1">
                          <div
                            className="h-full rounded-full bg-secondary/60"
                            style={{
                              width: `${clampPercent(e.turnoutRate)}%`,
                            }}
                          />
                        </div>
                        <Tooltip content="Effective turnout rate for this group (national baseline ± any active state modifier). Matches the 'Actual' rate on the state Demographics & Turnout page.">
                          <span className="w-10 text-right tabular-nums text-foreground/80 cursor-help">
                            {formatPercent(e.turnoutRate)}%
                          </span>
                        </Tooltip>
                        <Tooltip content="This group's share of your state's total population.">
                          <span className="w-12 text-right tabular-nums text-muted/60 cursor-help">
                            {formatPercent(e.statePct)}% pop
                          </span>
                        </Tooltip>
                        <Tooltip content="Estimated voters = state population × group % × turnout rate.">
                          <span className="w-16 text-right tabular-nums text-muted cursor-help">
                            {formatNum(e.turnoutPop)}
                          </span>
                        </Tooltip>
                      </div>
                    ))}
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
