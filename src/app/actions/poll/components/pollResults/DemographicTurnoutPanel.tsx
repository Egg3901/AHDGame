"use client";

import { Tooltip } from "@/components/Tooltip";
import { formatNum } from "../../pollHelpers";
import type { DemographicTurnoutData } from "../../types";

const DEMOGRAPHIC_SECTIONS: Array<{
  key: keyof DemographicTurnoutData;
  label: string;
  tooltip: string;
}> = [
  {
    key: "race",
    label: "Race / Ethnicity",
    tooltip:
      "Estimated voter turnout and count by racial/ethnic group. Turnout rates are national baselines; population shares are state-specific.",
  },
  {
    key: "age",
    label: "Age Group",
    tooltip:
      "Older voters consistently turn out at higher rates. This affects which groups are larger in your state's modeled electorate.",
  },
  {
    key: "education",
    label: "Education",
    tooltip:
      "College and graduate-degree holders vote at significantly higher rates, boosting groups like Secular Professionals and College Liberals.",
  },
  {
    key: "wealth",
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
    <section aria-labelledby="poll-turnout-heading">
      <button
        type="button"
        aria-expanded={demoTurnoutOpen}
        className="flex w-full items-center gap-3 text-left"
        onClick={() => setDemoTurnoutOpen((v) => !v)}
      >
        <div className="min-w-0 flex-1">
          <h2 id="poll-turnout-heading" className="text-heading font-semibold">
            <Tooltip content="Effective turnout rates by demographic slice (national baseline plus any GOTV, canvassing or suppression modifier on your state), applied to your state's population. Matches the rates the election engine uses.">
              <span>Likely voter turnout by demographic</span>
            </Tooltip>
          </h2>
          <p className="text-body-sm text-muted">
            {formatNum(allTurnoutPop)} estimated total voters
          </p>
        </div>
        <span className="shrink-0 text-body-sm font-medium text-secondary">
          {demoTurnoutOpen ? "Hide" : "Show"}
        </span>
        <svg
          className={`h-4 w-4 shrink-0 text-muted transition-transform duration-200 ${demoTurnoutOpen ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          aria-hidden
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {demoTurnoutOpen && (
        <div className="mt-4">
          <p className="text-body-sm text-muted">
            Turnout rates are national baselines adjusted for any active GOTV, canvassing or
            suppression modifier on your state. Population shares are state-specific. Estimated
            voters = state pop x group % x turnout rate.
          </p>
          <div className="mt-4 grid gap-x-10 gap-y-6 lg:grid-cols-2">
            {DEMOGRAPHIC_SECTIONS.map(({ key, label, tooltip }) => {
              const entries = demographicTurnout[key]
                .slice()
                .sort((a, b) => b.turnoutPop - a.turnoutPop);
              const totalTurnoutPop = entries.reduce((s, e) => s + e.turnoutPop, 0);
              return (
                <div key={key}>
                  <div className="mb-2 flex items-baseline gap-2">
                    <h3 className="text-body-lg font-semibold">
                      <Tooltip content={tooltip}>
                        <span className="cursor-help">{label}</span>
                      </Tooltip>
                    </h3>
                    <span className="ml-auto text-body-sm text-muted">
                      {formatNum(totalTurnoutPop)} est. voters
                    </span>
                  </div>
                  <div className="space-y-2">
                    {entries.map((e) => (
                      <div
                        key={e.key}
                        className="grid grid-cols-[minmax(0,1fr)_3.5rem_4.5rem_3.5rem] items-center gap-x-3 gap-y-1 text-body-sm"
                      >
                        <span className="truncate text-foreground">{e.label}</span>
                        <Tooltip content="Effective turnout rate for this group (national baseline plus any active state modifier). Matches the 'Actual' rate on the state Demographics and Turnout page.">
                          <span className="cursor-help text-right font-medium tabular-nums">
                            {formatPercent(e.turnoutRate)}%
                          </span>
                        </Tooltip>
                        <Tooltip content="This group's share of your state's total population.">
                          <span className="cursor-help text-right tabular-nums text-muted">
                            {formatPercent(e.statePct)}% pop
                          </span>
                        </Tooltip>
                        <Tooltip content="Estimated voters = state population x group % x turnout rate.">
                          <span className="cursor-help text-right tabular-nums text-muted">
                            {formatNum(e.turnoutPop)}
                          </span>
                        </Tooltip>
                        <div className="col-span-4 h-1.5 overflow-hidden rounded-full bg-card-border">
                          <div
                            className="h-full rounded-full bg-secondary"
                            style={{ width: `${clampPercent(e.turnoutRate)}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
