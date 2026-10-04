"use client";

import type { PMRegistryData } from "./registryTypes";
import { CategoryCard } from "./CategoryCard";
import { GovernanceStyleCard } from "./GovernanceStyleCard";
import {
  EMPTY_SERIES,
  deltaTextClass,
  formatDelta,
  movementSince,
  overallAtSnapshot,
  yearStepsBack,
} from "./movement";
import { scoreTone } from "./tones";

/** A movement tile's value and tone, or the honest empty state. */
function movement(
  data: PMRegistryData,
  stepsBack: number
): { value: string; sub: string; toneText?: string } {
  const change = movementSince(data.overall, overallAtSnapshot(data, stepsBack));
  if (!change) return { value: "n/a", sub: EMPTY_SERIES };
  return {
    value: formatDelta(change.delta),
    sub: `from ${Math.round(change.from)}`,
    toneText: deltaTextClass(change.delta),
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
      <div className="font-mono text-body-sm uppercase tracking-wider text-muted">{label}</div>
      <div className={`mt-0.5 text-body-lg font-bold tabular-nums ${toneText ?? "text-muted"}`}>
        {value}
      </div>
      <div className="text-body-sm text-muted">{sub}</div>
    </div>
  );
}

export function OverviewView({
  data,
  onOpenCategory,
  onOpenMetric,
  showGovernanceStyle,
  governanceScopeNote,
}: {
  data: PMRegistryData;
  onOpenCategory: (categoryId: string) => void;
  onOpenMetric: (categoryId: string, metricId: string) => void;
  showGovernanceStyle: boolean;
  /** Passed through to the governance card; a region view explains the national half. */
  governanceScopeNote?: string;
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
              <div className="font-mono text-body-sm uppercase tracking-widest text-muted">
                Overall condition
              </div>
              <div className="mt-0.5 text-heading font-semibold text-foreground">
                {data.overallStatus}
              </div>
              <div className="text-body-sm text-muted">mean of nine category scores</div>
            </div>
          </div>
          {/* Labelled by what the series actually holds. Snapshots land every
              `historyCadenceTurns`, so "since last turn" was never a thing this
              data could answer. */}
          <Tile label={`Δ last ${data.historyCadenceTurns} turns`} {...movement(data, 0)} />
          <Tile
            label="Δ over past year"
            {...movement(data, yearStepsBack(data.historyCadenceTurns))}
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
        <GovernanceStyleCard score={data.governanceStyle} scopeNote={governanceScopeNote} />
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

      <div className="flex flex-wrap gap-4 font-mono text-body-sm uppercase tracking-wider text-muted">
        <span>Strip: position = political lean (L→R)</span>
        <span>Bar = objective score</span>
        <span>Lean describes association, not quality</span>
      </div>
    </section>
  );
}
