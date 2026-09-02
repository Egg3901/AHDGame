"use client";

import type { PMRegistryData } from "./registryTypes";
// Safe in a client component: historyCadence has no imports of its own, so it
// cannot drag the turn engine into the browser bundle.
import { TURNS_PER_YEAR } from "@/lib/politicalMetrics/historyCadence";
import { CategoryCard } from "./CategoryCard";
import { GovernanceStyleCard } from "./GovernanceStyleCard";
import { scoreTone } from "./tones";

/** Shown until a scope has two snapshots to compare. */
const EMPTY_SERIES = "series begins this campaign";

/**
 * The overall score as of `stepsBack` snapshots ago, or null when the series is
 * not that deep yet.
 *
 * Computed per category and then averaged, matching `overallScore` rather than
 * flat-averaging all 63 metrics. The two agree while every category holds seven
 * families, but the category mean is the definition, and a future category of a
 * different size should not silently reweight the history.
 */
function overallAtSnapshot(data: PMRegistryData, stepsBack: number): number | null {
  const categoryScores: number[] = [];
  for (const category of data.categories) {
    let sum = 0;
    for (const metric of category.metrics) {
      const index = metric.history.length - 1 - stepsBack;
      if (index < 0) return null;
      sum += metric.history[index].value;
    }
    if (category.metrics.length === 0) return null;
    categoryScores.push(sum / category.metrics.length);
  }
  if (categoryScores.length === 0) return null;
  return categoryScores.reduce((a, b) => a + b, 0) / categoryScores.length;
}

/** A movement tile's value and tone, or the honest empty state. */
function movement(
  data: PMRegistryData,
  stepsBack: number
): { value: string; sub: string; toneText?: string } {
  const past = overallAtSnapshot(data, stepsBack);
  if (past === null) return { value: "—", sub: EMPTY_SERIES };
  const delta = Math.round((data.overall - past) * 10) / 10;
  return {
    value: `${delta > 0 ? "+" : ""}${delta}`,
    sub: `from ${Math.round(past)}`,
    toneText: delta > 0 ? "text-success" : delta < 0 ? "text-error" : "text-muted",
  };
}

function Tile({
  label,
  value,
  sub,
  toneText,
}: {
  label: string;
  value: string;
  sub: string;
  toneText?: string;
}) {
  return (
    <div className="border-l border-card-border px-4 py-3 first:border-l-0">
      <div className="font-mono text-body-xs uppercase tracking-wider text-muted">{label}</div>
      <div className={`mt-0.5 text-body-lg font-bold tabular-nums ${toneText ?? "text-muted"}`}>
        {value}
      </div>
      <div className="text-body-xs text-muted">{sub}</div>
    </div>
  );
}

export function OverviewView({
  data,
  onOpenCategory,
  onOpenMetric,
  showGovernanceStyle,
}: {
  data: PMRegistryData;
  onOpenCategory: (categoryId: string) => void;
  onOpenMetric: (categoryId: string, metricId: string) => void;
  showGovernanceStyle: boolean;
}) {
  const tone = scoreTone(data.overall);
  const sorted = [...data.categories].sort((a, b) => b.score - a.score);
  const strongest = sorted[0];
  const weakest = sorted[sorted.length - 1];
  const criticalCount = data.categories
    .flatMap((c) => c.metrics)
    .filter((m) => m.value < 25).length;

  // Condition ring geometry (raw SVG values are isolated here by necessity;
  // colors still come from tokens via currentColor).
  const size = 84;
  const r = (size - 8) / 2;
  const circ = 2 * Math.PI * r;

  return (
    <section className="mt-4 flex flex-col gap-4">
      <div className="overflow-hidden rounded-lg border border-card-border bg-card p-0 shadow-card">
        <div className="grid grid-cols-2 lg:grid-cols-[minmax(230px,1.5fr)_repeat(4,minmax(0,1fr))]">
          <div className="col-span-2 flex items-center gap-4 border-b border-card-border px-4 py-3 lg:col-span-1 lg:border-b-0 lg:border-r">
            <span className={`relative inline-flex ${tone.text}`} aria-label="Overall score">
              <svg width={size} height={size} className="-rotate-90">
                <circle
                  cx={size / 2}
                  cy={size / 2}
                  r={r}
                  fill="none"
                  className="stroke-track"
                  strokeWidth="7"
                />
                <circle
                  cx={size / 2}
                  cy={size / 2}
                  r={r}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="7"
                  strokeLinecap="round"
                  strokeDasharray={circ.toFixed(1)}
                  strokeDashoffset={(circ * (1 - data.overall / 100)).toFixed(1)}
                />
              </svg>
              <span className="absolute inset-0 flex items-center justify-center">
                <span className="text-heading font-extrabold tabular-nums">
                  {Math.round(data.overall)}
                </span>
              </span>
            </span>
            <div>
              <div className="font-mono text-body-xs uppercase tracking-widest text-muted">
                Overall condition
              </div>
              <div className="mt-0.5 font-display text-heading font-semibold text-foreground">
                {data.overallStatus}
              </div>
              <div className="text-body-xs text-muted">mean of nine category scores</div>
            </div>
          </div>
          {/* Labelled by what the series actually holds. Snapshots land every
              `historyCadenceTurns`, so "since last turn" was never a thing this
              data could answer. */}
          <Tile label={`Δ last ${data.historyCadenceTurns} turns`} {...movement(data, 0)} />
          <Tile
            label="Δ over past year"
            {...movement(
              data,
              Math.max(1, Math.round(TURNS_PER_YEAR / data.historyCadenceTurns)) - 1
            )}
          />
          <Tile
            label="Critical metrics"
            value={String(criticalCount)}
            sub="score below 25"
            toneText={criticalCount > 0 ? "text-error" : "text-muted"}
          />
          <Tile
            label="Strongest / weakest"
            value={`${Math.round(strongest.score)} / ${Math.round(weakest.score)}`}
            sub={`${strongest.displayName} / ${weakest.displayName}`}
            toneText="text-foreground"
          />
        </div>
      </div>

      {showGovernanceStyle && data.governanceStyle && (
        <GovernanceStyleCard score={data.governanceStyle} />
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {data.categories.map((cat) => (
          <CategoryCard
            key={cat.id}
            category={cat}
            onOpenCategory={onOpenCategory}
            onOpenMetric={onOpenMetric}
          />
        ))}
      </div>

      <div className="flex flex-wrap gap-4 font-mono text-body-xs uppercase tracking-wider text-muted">
        <span>Strip: position = political lean (L→R)</span>
        <span>Bar = objective score</span>
        <span>Lean describes association, not quality</span>
      </div>
    </section>
  );
}
